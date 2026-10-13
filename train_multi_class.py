#!/usr/bin/env python3
"""
Train YOLOv8 for multi-class road hazard detection.
"""

from ultralytics import YOLO
import argparse
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Train YOLOv8 for road hazard detection')
    parser.add_argument('--epochs', type=int, default=100, help='Number of epochs')
    parser.add_argument('--batch', type=int, default=8, help='Batch size')
    parser.add_argument('--imgsz', type=int, default=640, help='Image size')
    parser.add_argument('--device', type=int, default=0, help='CUDA device (0 for GPU, -1 for CPU)')
    parser.add_argument('--workers', type=int, default=0 if os.name == 'nt' else 8,
                        help='DataLoader worker processes (Windows default=0 to avoid paging-file issues)')
    parser.add_argument('--model', type=str, default='yolov8s.pt',
                        help='Model checkpoint to start from (e.g., yolov8n.pt, yolov8s.pt)')
    parser.add_argument('--resume', action='store_true', help='Resume from last checkpoint')
    parser.add_argument('--data-yaml', type=str, default='datasets/road_hazards_combined/data_multiclass.yaml',
                        help='Path to data.yaml (default: datasets/road_hazards_combined/data_multiclass.yaml)')
    # Augmentation knobs (optional)
    parser.add_argument('--mosaic', type=float, help='Mosaic augmentation probability (0-1)')
    parser.add_argument('--mixup', type=float, help='MixUp augmentation probability (0-1)')
    parser.add_argument('--copy_paste', type=float, help='Copy-Paste augmentation probability (0-1)')
    parser.add_argument('--perspective', type=float, help='Random perspective magnitude (0-0.001)')
    parser.add_argument('--degrees', type=float, help='Random rotation degrees')
    parser.add_argument('--shear', type=float, help='Random shear magnitude')
    parser.add_argument('--translate', type=float, help='Random translation fraction (0-1)')
    parser.add_argument('--scale', type=float, help='Random scale gain (e.g., 0.5-1.5)')
    parser.add_argument('--fliplr', type=float, help='Left-right flip probability (0-1)')
    parser.add_argument('--flipud', type=float, help='Up-down flip probability (0-1)')
    parser.add_argument('--hsv_h', type=float, help='HSV-Hue augmentation fraction (0-1)')
    parser.add_argument('--hsv_s', type=float, help='HSV-Saturation augmentation fraction (0-1)')
    parser.add_argument('--hsv_v', type=float, help='HSV-Value augmentation fraction (0-1)')
    args = parser.parse_args()
    
    data_yaml_path = Path(args.data_yaml)
    if not data_yaml_path.exists():
        fallback_path = Path('datasets/road_hazards_combined') / args.data_yaml
        if fallback_path.exists():
            data_yaml_path = fallback_path
        else:
            raise FileNotFoundError(
                f"Dataset yaml not found: {args.data_yaml}. "
                f"Try '--data-yaml datasets/road_hazards_combined/data_multiclass.yaml'"
            )

    # Load model
    model = YOLO(args.model)
    
    # Train
    print("\n" + "=" * 80)
    print("YOLOv8 Multi-Class Road Hazard Detection Training")
    print("=" * 80)
    print(f"\nDataset yaml: {data_yaml_path}")
    print(f"Training config:")
    print(f"  Model:   {args.model}")
    print(f"  Epochs:  {args.epochs}")
    print(f"  Batch:   {args.batch}")
    print(f"  Image:   {args.imgsz}x{args.imgsz}")
    print(f"  Device:  {'GPU' if args.device >= 0 else 'CPU'}")
    print(f"  Workers: {args.workers}")
    print("=" * 80 + "\n")
    
    # Build train kwargs with optional augmentation overrides
    train_kwargs = dict(
        data=str(data_yaml_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        name='road_hazards_multi',
        patience=20,
        save=True,
        resume=args.resume,
        workers=args.workers,
        verbose=True,
    )
    for k in ['mosaic','mixup','copy_paste','perspective','degrees','shear','translate','scale','fliplr','flipud','hsv_h','hsv_s','hsv_v']:
        v = getattr(args, k)
        if v is not None:
            train_kwargs[k] = v

    try:
        results = model.train(**train_kwargs)
    except AssertionError as e:
        if "nothing to resume" in str(e):
            print(f"⚠️  Training already finished. Restarting without resume...\n")
            train_kwargs['resume'] = False
            results = model.train(**train_kwargs)
        else:
            raise
    except OSError as e:
        if 'WinError 1455' in str(e) or 'paging file is too small' in str(e).lower():
            raise RuntimeError(
                'Windows virtual memory (paging file) is too small for current training settings. '
                'Retry with lower memory pressure, e.g. --workers 0 --batch 4 --imgsz 512, '
                'or increase Windows paging file size.'
            ) from e
        raise
    
    # Validation
    print("\n" + "=" * 80)
    print("VALIDATION")
    print("=" * 80)
    metrics = model.val()
    
    # Test
    print("\n" + "=" * 80)
    print("TEST SET EVALUATION")
    print("=" * 80)
    model.predict(source='datasets/road_hazards_combined/test/images', save=True)
    
    print("\n" + "=" * 80)
    print("TRAINING COMPLETE")
    print("=" * 80)
    print(f"\nBest model: runs/detect/road_hazards_multi/weights/best.pt")
    print(f"Last model: runs/detect/road_hazards_multi/weights/last.pt")
    print("\nTo use for inference:")
    print("  model = YOLO('runs/detect/road_hazards_multi/weights/best.pt')")
    print("  results = model.predict(source='image.jpg')")
    print("=" * 80 + "\n")

if __name__ == '__main__':
    main()
