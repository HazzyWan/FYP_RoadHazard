#!/usr/bin/env python3
"""
Fast dataset merge using hardlinks for speed
60% Malaysian + 40% New dataset + optional extra crack dataset
"""

import os
import shutil
import random
import argparse
from pathlib import Path
from collections import defaultdict

MALAYSIAN_DATASET = Path("datasets/pothole_dataset")
NEW_DATASET = Path("datasets/crack and pothole.v1i.yolov8")
OUTPUT_DATASET = Path("datasets/road_hazards_combined")

def remap_label_content(content, class_map):
    """Remap class IDs in label content"""
    if not content.strip():
        return ""
    
    lines = []
    for line in content.strip().split('\n'):
        if line:
            parts = line.split()
            if parts:
                old_class = int(parts[0])
                new_class = class_map.get(old_class, old_class)
                new_line = f"{new_class} " + " ".join(parts[1:])
                lines.append(new_line)
    return "\n".join(lines) + "\n" if lines else ""

def link_and_remap(src_image, src_label, dst_image, dst_label, class_map):
    """Hardlink image and create remapped label"""
    if dst_image.exists():
        dst_image.unlink()
    if dst_label.exists():
        dst_label.unlink()
    # Hardlink image (much faster than copy)
    os.link(src_image, dst_image)
    
    # Remap and write label
    if src_label.exists():
        with open(src_label, 'r') as f:
            content = f.read()
        remapped = remap_label_content(content, class_map)
        with open(dst_label, 'w') as f:
            f.write(remapped)
    else:
        dst_label.touch()

def main():
    parser = argparse.ArgumentParser(description="Merge pothole + crack datasets")
    parser.add_argument('--extra_crack_dir', type=str, default=None,
                        help='Optional extra crack-only dataset root (YOLO format)')
    args = parser.parse_args()

    extra_crack_path = Path(args.extra_crack_dir) if args.extra_crack_dir else None

    print("\n" + "=" * 80)
    print("FAST DATASET MERGE: Malaysian (60%) + New (40%)" + (" + Extra Cracks" if extra_crack_path else ""))
    print("=" * 80)
    
    # Reset output directory to avoid stale/duplicate files from previous merges
    print("\n[Step 1] Resetting output directory and creating structure...")
    if OUTPUT_DATASET.exists():
        shutil.rmtree(OUTPUT_DATASET)
    for split in ['train', 'valid', 'test']:
        (OUTPUT_DATASET / split / 'images').mkdir(parents=True, exist_ok=True)
        (OUTPUT_DATASET / split / 'labels').mkdir(parents=True, exist_ok=True)
    print("[OK] Directories created")
    
    # Process Malaysian dataset (60%)
    print("\n[Step 2] Processing Malaysian dataset (potholes as class 0)...")
    m_count = 0
    for split in ['train', 'valid', 'test']:
        images_dir = MALAYSIAN_DATASET / split / 'images'
        labels_dir = MALAYSIAN_DATASET / split / 'labels'
        
        if images_dir.exists():
            for img_file in images_dir.iterdir():
                if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                    label_file = labels_dir / (img_file.stem + '.txt')
                    dst_image = OUTPUT_DATASET / split / 'images' / img_file.name
                    dst_label = OUTPUT_DATASET / split / 'labels' / (img_file.stem + '.txt')
                    
                    # No remapping needed for Malaysian (class 0 = pothole)
                    link_and_remap(img_file, label_file, dst_image, dst_label, {})
                    m_count += 1
    
    print(f"[OK] Malaysian dataset: {m_count} images linked")
    
    # Process new dataset (40%)
    print("\n[Step 3] Processing new dataset (crack->class 1, pothole->class 0)...")
    n_count = 0
    for split in ['train', 'valid', 'test']:
        images_dir = NEW_DATASET / split / 'images'
        labels_dir = NEW_DATASET / split / 'labels'
        
        if images_dir.exists():
            for img_file in images_dir.iterdir():
                if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                    label_file = labels_dir / (img_file.stem + '.txt')
                    # Add prefix to avoid conflicts
                    new_name = f"new_{img_file.name}"
                    dst_image = OUTPUT_DATASET / split / 'images' / new_name
                    dst_label = OUTPUT_DATASET / split / 'labels' / (Path(new_name).stem + '.txt')
                    
                    # Remap: 0→1 (crack), 1→0 (pothole)
                    link_and_remap(img_file, label_file, dst_image, dst_label, {0: 1, 1: 0})
                    n_count += 1
    
    print(f"[OK] New dataset: {n_count} images linked (remapped)")
    
    # Optional extra crack-only dataset (assumes class 0 = crack)
    extra_count = 0
    if extra_crack_path and extra_crack_path.exists():
        print("\n[Step 4] Processing EXTRA crack dataset (class 0 → crack)")
        for split in ['train', 'valid', 'test']:
            images_dir = extra_crack_path / split / 'images'
            labels_dir = extra_crack_path / split / 'labels'
            if images_dir.exists():
                for img_file in images_dir.iterdir():
                    if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                        label_file = labels_dir / (img_file.stem + '.txt')
                        new_name = f"extra_{img_file.name}"
                        dst_image = OUTPUT_DATASET / split / 'images' / new_name
                        dst_label = OUTPUT_DATASET / split / 'labels' / (Path(new_name).stem + '.txt')
                        link_and_remap(img_file, label_file, dst_image, dst_label, {0: 1})
                        extra_count += 1
        print(f"[OK] Extra crack dataset: {extra_count} images linked (class 0->1)")

    # Create data.yaml
    print("\n[Step 5] Creating data.yaml configuration...")
    data_yaml = """path: ../datasets/road_hazards_combined
train: train/images
val: valid/images
test: test/images

nc: 2
names: ['pothole', 'crack']

# Dataset composition: 60% Malaysian Pothole + 40% New Crack+Pothole
"""
    with open(OUTPUT_DATASET / 'data.yaml', 'w') as f:
        f.write(data_yaml)
    print("[OK] data.yaml created")
    
    # Summary
    print("\n" + "=" * 80)
    print("MERGE COMPLETE")
    print("=" * 80)
    
    split_summary = {}
    for split in ['train', 'valid', 'test']:
        images = list((OUTPUT_DATASET / split / 'images').iterdir())
        split_summary[split] = len(images)
        print(f"  {split.upper():6}: {len(images):5d} images")
    
    total = sum(split_summary.values())
    print(f"  {'-' * 25}")
    print(f"  {'TOTAL':6}: {total:5d} images")
    
    print(f"\nClass mapping:")
    print(f"  0 = pothole")
    print(f"  1 = crack")
    
    print(f"\nDataset location: {OUTPUT_DATASET}")
    print(f"Config file: {OUTPUT_DATASET / 'data.yaml'}")
    print("\n" + "=" * 80 + "\n")

if __name__ == '__main__':
    main()
