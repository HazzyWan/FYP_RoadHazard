#!/usr/bin/env python3
"""
Prepare class-sorted review artifacts from a YOLO detection dataset.

What it generates (for a chosen split):
1) full_by_class/<class_name>/...      -> full images that contain that class
2) crops_by_class/<class_name>/...     -> cropped bbox patches for that class
3) bbox_index.csv                      -> per-bbox index for quick audit/filtering

Default dataset targets the current project structure.
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
from pathlib import Path

from PIL import Image


DEFAULT_DATASET_ROOT = Path("datasets/road_hazards_combined")
DEFAULT_CLASS_NAMES = [
    "pothole",
    "alligator_crack",
    "longitudinal_crack",
    "transverse_crack",
    "other",
]


def parse_label_line(line: str):
    parts = line.strip().split()
    if len(parts) < 5:
        return None
    try:
        class_id = int(float(parts[0]))
        x_center = float(parts[1])
        y_center = float(parts[2])
        width = float(parts[3])
        height = float(parts[4])
    except ValueError:
        return None
    return class_id, x_center, y_center, width, height


def ensure_clean_dir(path: Path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def link_or_copy(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
    except Exception:
        shutil.copy2(src, dst)


def yolo_to_xyxy(xc: float, yc: float, w: float, h: float, img_w: int, img_h: int):
    x1 = max(0, int((xc - w / 2.0) * img_w))
    y1 = max(0, int((yc - h / 2.0) * img_h))
    x2 = min(img_w, int((xc + w / 2.0) * img_w))
    y2 = min(img_h, int((yc + h / 2.0) * img_h))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def main():
    parser = argparse.ArgumentParser(description="Generate class-sorted review folders and bbox crops")
    parser.add_argument("--dataset-root", type=str, default=str(DEFAULT_DATASET_ROOT))
    parser.add_argument("--split", type=str, default="test", choices=["train", "valid", "test"])
    parser.add_argument("--output", type=str, default="datasets/road_hazards_combined/review")
    args = parser.parse_args()

    dataset_root = Path(args.dataset_root)
    split = args.split
    output_root = Path(args.output) / split

    images_dir = dataset_root / split / "images"
    labels_dir = dataset_root / split / "labels"

    if not images_dir.exists() or not labels_dir.exists():
        raise FileNotFoundError(f"Missing split folders: {images_dir} or {labels_dir}")

    full_by_class_dir = output_root / "full_by_class"
    crops_by_class_dir = output_root / "crops_by_class"
    ensure_clean_dir(full_by_class_dir)
    ensure_clean_dir(crops_by_class_dir)

    for class_name in DEFAULT_CLASS_NAMES:
        (full_by_class_dir / class_name).mkdir(parents=True, exist_ok=True)
        (crops_by_class_dir / class_name).mkdir(parents=True, exist_ok=True)

    bbox_index_path = output_root / "bbox_index.csv"
    output_root.mkdir(parents=True, exist_ok=True)

    per_box_counts = {name: 0 for name in DEFAULT_CLASS_NAMES}
    per_image_counts = {name: 0 for name in DEFAULT_CLASS_NAMES}
    missing_labels = 0

    image_files = sorted([p for p in images_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}])

    with bbox_index_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow([
            "split",
            "image_name",
            "bbox_idx",
            "class_id",
            "class_name",
            "x_center",
            "y_center",
            "width",
            "height",
            "crop_path",
            "full_image_path",
        ])

        for image_path in image_files:
            label_path = labels_dir / f"{image_path.stem}.txt"
            if not label_path.exists():
                missing_labels += 1
                continue

            lines = [ln for ln in label_path.read_text(encoding="utf-8", errors="ignore").splitlines() if ln.strip()]
            if not lines:
                continue

            with Image.open(image_path) as image_obj:
                image_obj = image_obj.convert("RGB")
                img_w, img_h = image_obj.size

                classes_in_image = set()
                for bbox_idx, line in enumerate(lines):
                    parsed = parse_label_line(line)
                    if parsed is None:
                        continue

                    class_id, xc, yc, bw, bh = parsed
                    if class_id < 0 or class_id >= len(DEFAULT_CLASS_NAMES):
                        class_name = f"class_{class_id}"
                    else:
                        class_name = DEFAULT_CLASS_NAMES[class_id]

                    crop_xyxy = yolo_to_xyxy(xc, yc, bw, bh, img_w, img_h)
                    if crop_xyxy is None:
                        continue

                    classes_in_image.add(class_name)
                    if class_name in per_box_counts:
                        per_box_counts[class_name] += 1

                    x1, y1, x2, y2 = crop_xyxy
                    crop = image_obj.crop((x1, y1, x2, y2))

                    crop_name = f"{image_path.stem}__b{bbox_idx}__c{class_id}.jpg"
                    crop_rel = Path("crops_by_class") / class_name / crop_name
                    crop_abs = output_root / crop_rel
                    crop.save(crop_abs, format="JPEG", quality=95)

                    full_rel = Path("full_by_class") / class_name / image_path.name

                    writer.writerow([
                        split,
                        image_path.name,
                        bbox_idx,
                        class_id,
                        class_name,
                        xc,
                        yc,
                        bw,
                        bh,
                        str(crop_rel).replace("\\", "/"),
                        str(full_rel).replace("\\", "/"),
                    ])

            for class_name in classes_in_image:
                if class_name in per_image_counts:
                    per_image_counts[class_name] += 1
                dst = full_by_class_dir / class_name / image_path.name
                link_or_copy(image_path, dst)

    print("=" * 80)
    print(f"REVIEW EXPORT COMPLETE ({split.upper()})")
    print("=" * 80)
    print(f"Input images: {len(image_files)}")
    print(f"Missing labels: {missing_labels}")
    print(f"Output folder: {output_root}")
    print(f"BBox index: {bbox_index_path}")
    print("\nPer-box counts:")
    for class_name in DEFAULT_CLASS_NAMES:
        print(f"  {class_name:20}: {per_box_counts[class_name]}")
    print("\nPer-image counts (image contains at least one box of class):")
    for class_name in DEFAULT_CLASS_NAMES:
        print(f"  {class_name:20}: {per_image_counts[class_name]}")
    print("=" * 80)


if __name__ == "__main__":
    main()
