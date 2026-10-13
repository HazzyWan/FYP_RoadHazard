#!/usr/bin/env python3
"""
Auto-label crack subtypes based on image analysis.
Classifies generic cracks into: alligator, longitudinal, transverse, or other.
Pothole labels are preserved as-is and are never auto-converted.

Definitions:
- longitudinal_crack: along road direction
- transverse_crack: across road direction

Road direction is configurable with --road-axis:
- vertical (default): road flows top-to-bottom in image
- horizontal: road flows left-to-right in image
"""

import os
import argparse
import cv2
import numpy as np
from pathlib import Path
from collections import defaultdict

# Class mapping for new 5-class system
CLASS_MAPPING = {
    0: 'pothole',
    1: 'alligator_crack',
    2: 'longitudinal_crack',
    3: 'transverse_crack',
    4: 'other'
}

# Only generic crack labels should be reclassified into crack subtypes.
SOURCE_CRACK_CLASS_ID = 1

def get_bbox_region(image, bbox_line):
    """
    Extract bounding box region from image.
    bbox_line format: class x_center y_center width height (normalized 0-1)
    Returns: cropped region
    """
    try:
        parts = bbox_line.strip().split()
        if len(parts) < 5:
            return None, None
        
        h, w = image.shape[:2]
        cls_id, x_c, y_c, box_w, box_h = map(float, parts[:5])
        
        x1 = max(0, int((x_c - box_w/2) * w))
        y1 = max(0, int((y_c - box_h/2) * h))
        x2 = min(w, int((x_c + box_w/2) * w))
        y2 = min(h, int((y_c + box_h/2) * h))
        
        if x2 <= x1 or y2 <= y1:
            return None, None
        
        region = image[y1:y2, x1:x2]
        return region, int(cls_id)
    except Exception as e:
        print(f"Error parsing bbox: {e}")
        return None, None

def _normalize_line_angle_deg(angle_rad):
    angle = np.degrees(angle_rad) % 180.0
    if angle < 0:
        angle += 180.0
    return angle


def _angle_distance_deg(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _estimate_orientation_deg(edges):
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=20, minLineLength=10, maxLineGap=5)
    if lines is None or len(lines) == 0:
        return None, None, 0

    angles = []
    lengths = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx = x2 - x1
        dy = y2 - y1
        length = np.hypot(dx, dy)
        if length < 3:
            continue
        angles.append(_normalize_line_angle_deg(np.arctan2(dy, dx)))
        lengths.append(length)

    if not angles:
        return None, None, 0

    bins = np.arange(0, 181, 10)
    hist, bin_edges = np.histogram(angles, bins=bins, weights=lengths)
    peak_idx = int(np.argmax(hist))
    dominant = float((bin_edges[peak_idx] + bin_edges[peak_idx + 1]) / 2.0)

    weighted_dist = 0.0
    total_weight = float(np.sum(lengths))
    for ang, w in zip(angles, lengths):
        weighted_dist += _angle_distance_deg(ang, dominant) * w
    dispersion = weighted_dist / max(total_weight, 1e-6)

    return dominant, dispersion, len(angles)


def analyze_crack_pattern(region, road_axis='vertical'):
    """
    Analyze crack pattern in image region.
    Returns: crack_type (string), confidence (0-1)
    """
    if region is None or region.size == 0:
        return 'other', 0.0
    
    h, w = region.shape[:2]
    
    # Skip small regions
    if h < 20 or w < 20:
        return 'other', 0.0
    
    # Convert to grayscale
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    
    # Edge detection
    edges = cv2.Canny(gray, 50, 150)
    
    # Morphological operations to enhance patterns
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    
    # Count edge pixels
    edge_pixel_ratio = np.sum(edges > 0) / edges.size
    
    # Detect contours for web-like texture features
    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    # Orientation features from line segments
    dominant_angle, angle_dispersion, num_lines = _estimate_orientation_deg(edges)
    num_contours = len(contours)

    # Decision logic

    # Alligator crack = dense network + many contours + weak orientation coherence
    if edge_pixel_ratio > 0.12 and num_contours > 12:
        if dominant_angle is None or angle_dispersion is None or angle_dispersion > 28:
            confidence = min(0.92, 0.45 + edge_pixel_ratio * 1.8)
            return 'alligator_crack', confidence

    # If no orientation detected, avoid forcing a linear class
    if dominant_angle is None or angle_dispersion is None:
        return 'other', 0.45

    # 0° = horizontal, 90° = vertical
    if road_axis == 'horizontal':
        longitudinal_ref = 0.0
        transverse_ref = 90.0
    else:
        longitudinal_ref = 90.0
        transverse_ref = 0.0

    d_long = _angle_distance_deg(dominant_angle, longitudinal_ref)
    d_trans = _angle_distance_deg(dominant_angle, transverse_ref)

    # classify when orientation is coherent enough
    if angle_dispersion <= 25:
        if d_long <= d_trans:
            conf = max(0.55, min(0.9, 1.0 - d_long / 90.0))
            return 'longitudinal_crack', conf
        conf = max(0.55, min(0.9, 1.0 - d_trans / 90.0))
        return 'transverse_crack', conf
    
    # Fallback
    return 'other', 0.5

def auto_label_dataset(dataset_root='datasets/road_hazards_combined', road_axis='vertical'):
    """
    Scan dataset and auto-label crack types.
    Returns dict mapping image_file -> (crack_type, confidence)
    """
    dataset_path = Path(dataset_root)
    results = defaultdict(list)
    
    print("\n" + "="*80)
    print("AUTO-LABELING CRACK TYPES")
    print("="*80)
    
    for split in ['train', 'valid', 'test']:
        images_dir = dataset_path / split / 'images'
        labels_dir = dataset_path / split / 'labels'
        
        if not images_dir.exists():
            continue
        
        print(f"\n[{split.upper()}] Analyzing {len(list(images_dir.glob('*')))} images...")
        
        split_results = defaultdict(int)
        
        for img_file in sorted(images_dir.iterdir()):
            if img_file.suffix.lower() not in ['.jpg', '.jpeg', '.png']:
                continue
            
            label_file = labels_dir / (img_file.stem + '.txt')
            
            # Read image
            image = cv2.imread(str(img_file))
            if image is None:
                continue
            
            # Read labels (old format: class bbox)
            if label_file.exists():
                with open(label_file, 'r') as f:
                    lines = f.readlines()
            else:
                lines = []
            
            # Analyze each bbox in image
            new_labels = []
            for line in lines:
                region, old_class = get_bbox_region(image, line)
                
                if region is None:
                    # Keep original if analysis fails
                    new_labels.append(line)
                    continue
                
                parts = line.strip().split()
                if len(parts) < 5:
                    new_labels.append(line)
                    continue

                # Keep potholes and any non-crack classes unchanged.
                if old_class != SOURCE_CRACK_CLASS_ID:
                    new_labels.append(line)
                    split_results[CLASS_MAPPING.get(old_class, 'other')] += 1
                    continue

                # Analyze only generic crack boxes into crack subtypes.
                crack_type, confidence = analyze_crack_pattern(region, road_axis=road_axis)
                if crack_type == 'pothole':
                    crack_type = 'other'
                new_class_id = {v: k for k, v in CLASS_MAPPING.items()}[crack_type]
                
                # Keep original bbox coordinates, only change class
                new_line = f"{new_class_id} " + " ".join(parts[1:]) + "\n"
                new_labels.append(new_line)
                split_results[crack_type] += 1
            
            # Write updated labels
            with open(label_file, 'w') as f:
                f.writelines(new_labels)
        
        # Print summary for this split
        print(f"  Results ({split.upper()}):")
        for crack_type, count in split_results.items():
            print(f"    {crack_type}: {count}")
        
        results[split] = split_results
    
    print("\n" + "="*80)
    print("AUTO-LABELING COMPLETE")
    print("="*80)
    
    return results

def create_multiclass_data_yaml(dataset_root='datasets/road_hazards_combined'):
    """Create updated data.yaml for 5-class system."""
    data_yaml = f"""path: ../datasets/road_hazards_combined
train: train/images
val: valid/images
test: test/images

nc: 5
names: ['pothole', 'alligator_crack', 'longitudinal_crack', 'transverse_crack', 'other']

# Multi-class road hazard detection
# Class distribution optimized for Malaysian roads
"""
    
    yaml_path = Path(dataset_root) / 'data_multiclass.yaml'
    with open(yaml_path, 'w') as f:
        f.write(data_yaml)
    
    print(f"[OK] Created {yaml_path}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Auto-label crack subtypes')
    parser.add_argument('dataset_root', nargs='?', default='datasets/road_hazards_combined')
    parser.add_argument('--road-axis', choices=['vertical', 'horizontal'], default='vertical',
                        help='Road direction in image: vertical (top-bottom) or horizontal (left-right)')
    args = parser.parse_args()

    # Auto-label
    results = auto_label_dataset(args.dataset_root, road_axis=args.road_axis)
    
    # Create multi-class config
    create_multiclass_data_yaml(args.dataset_root)
    
    print("\nNext steps:")
    print(f"1. Review auto-labeled results above")
    print(f"2. Retrain with: python train_multi_class.py --epochs 100 --data-yaml datasets/road_hazards_combined/data_multiclass.yaml")
