#!/usr/bin/env python3
"""
Prepare a balanced retraining dataset for multi-class road hazards.

- Rebuilds a new dataset from existing `road_hazards_combined` + corrected feedback samples.
- Balances classes using median target count (upsample minority, downsample majority).
- Re-splits into train/valid/test with per-class stratification.

Usage:
  python prepare_balanced_retrain_dataset.py --dry-run
  python prepare_balanced_retrain_dataset.py
  python prepare_balanced_retrain_dataset.py --target-per-class 1800 --seed 42
"""

from __future__ import annotations

import argparse
import random
import shutil
from dataclasses import dataclass
from pathlib import Path

CLASS_NAMES = ['pothole', 'alligator_crack', 'longitudinal_crack', 'transverse_crack', 'other']
CLASS_TO_ID = {name: idx for idx, name in enumerate(CLASS_NAMES)}


@dataclass(frozen=True)
class Sample:
    image_path: Path
    label_path: Path
    class_id: int
    source: str


def parse_args():
    parser = argparse.ArgumentParser(description='Build balanced retrain dataset')
    parser.add_argument('--source', type=str, default='datasets/road_hazards_combined', help='Source dataset root')
    parser.add_argument('--output', type=str, default='datasets/road_hazards_balanced', help='Output dataset root')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    parser.add_argument('--target-per-class', type=int, default=0, help='If >0, fixed target count per class')
    parser.add_argument('--train-ratio', type=float, default=0.80, help='Train split ratio')
    parser.add_argument('--val-ratio', type=float, default=0.10, help='Validation split ratio')
    parser.add_argument('--test-ratio', type=float, default=0.10, help='Test split ratio')
    parser.add_argument('--skip-feedback', action='store_true', help='Exclude corrected feedback samples')
    parser.add_argument('--dry-run', action='store_true', help='Print stats only without writing files')
    return parser.parse_args()


def _read_primary_class_id(label_path: Path) -> int | None:
    try:
        lines = [line.strip() for line in label_path.read_text(encoding='utf-8').splitlines() if line.strip()]
    except Exception:
        return None

    if not lines:
        return None

    best_class = None
    best_area = -1.0
    for line in lines:
        parts = line.split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(parts[0])
            width = float(parts[3])
            height = float(parts[4])
        except Exception:
            continue
        if class_id < 0 or class_id >= len(CLASS_NAMES):
            continue
        area = max(width, 0.0) * max(height, 0.0)
        if area > best_area:
            best_area = area
            best_class = class_id

    return best_class


def _paired_image_path(images_dir: Path, label_path: Path) -> Path | None:
    stem = label_path.stem
    candidates = [images_dir / f'{stem}{ext}' for ext in ['.jpg', '.jpeg', '.png', '.webp']]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def collect_base_samples(source_root: Path) -> list[Sample]:
    samples: list[Sample] = []
    for split in ['train', 'valid', 'test']:
        labels_dir = source_root / split / 'labels'
        images_dir = source_root / split / 'images'
        if not labels_dir.exists() or not images_dir.exists():
            continue

        for label_path in labels_dir.glob('*.txt'):
            class_id = _read_primary_class_id(label_path)
            if class_id is None:
                continue
            image_path = _paired_image_path(images_dir, label_path)
            if image_path is None:
                continue
            samples.append(Sample(image_path=image_path, label_path=label_path, class_id=class_id, source=f'base:{split}'))
    return samples


def collect_feedback_samples(source_root: Path) -> list[Sample]:
    feedback_root = source_root / 'feedback_by_class'
    if not feedback_root.exists():
        return []

    samples: list[Sample] = []
    for class_name in CLASS_NAMES:
        class_dir = feedback_root / class_name
        images_dir = class_dir / 'images'
        labels_dir = class_dir / 'labels'
        if not images_dir.exists() or not labels_dir.exists():
            continue

        class_id = CLASS_TO_ID[class_name]
        for label_path in labels_dir.glob('*.txt'):
            image_path = _paired_image_path(images_dir, label_path)
            if image_path is None:
                continue
            samples.append(Sample(image_path=image_path, label_path=label_path, class_id=class_id, source='feedback'))

    return samples


def summarize_counts(samples: list[Sample]) -> dict[int, int]:
    counts = {idx: 0 for idx in range(len(CLASS_NAMES))}
    for sample in samples:
        counts[sample.class_id] += 1
    return counts


def choose_target_count(counts: dict[int, int], fixed_target: int) -> int:
    if fixed_target > 0:
        return fixed_target

    non_zero = sorted(count for count in counts.values() if count > 0)
    if not non_zero:
        return 0

    mid = len(non_zero) // 2
    if len(non_zero) % 2 == 1:
        return non_zero[mid]
    return int(round((non_zero[mid - 1] + non_zero[mid]) / 2))


def build_balanced_pool(samples: list[Sample], target_count: int, rng: random.Random) -> list[Sample]:
    by_class: dict[int, list[Sample]] = {idx: [] for idx in range(len(CLASS_NAMES))}
    for sample in samples:
        by_class[sample.class_id].append(sample)

    balanced: list[Sample] = []
    for class_id, class_samples in by_class.items():
        if not class_samples:
            continue

        if len(class_samples) >= target_count:
            selected = rng.sample(class_samples, target_count)
            balanced.extend(selected)
            continue

        # Upsample with replacement to reach target count.
        selected = list(class_samples)
        needed = target_count - len(selected)
        selected.extend(rng.choices(class_samples, k=needed))
        balanced.extend(selected)

    rng.shuffle(balanced)
    return balanced


def stratified_split(samples: list[Sample], rng: random.Random, train_ratio: float, val_ratio: float):
    by_class: dict[int, list[Sample]] = {idx: [] for idx in range(len(CLASS_NAMES))}
    for sample in samples:
        by_class[sample.class_id].append(sample)

    train, val, test = [], [], []
    for class_id, class_samples in by_class.items():
        if not class_samples:
            continue
        rng.shuffle(class_samples)

        n = len(class_samples)
        n_train = max(1, int(round(n * train_ratio)))
        n_val = max(1, int(round(n * val_ratio)))
        if n_train + n_val >= n:
            n_val = max(1, n - n_train - 1)
        n_test = max(1, n - n_train - n_val)

        train.extend(class_samples[:n_train])
        val.extend(class_samples[n_train:n_train + n_val])
        test.extend(class_samples[n_train + n_val:n_train + n_val + n_test])

    rng.shuffle(train)
    rng.shuffle(val)
    rng.shuffle(test)
    return train, val, test


def _copy_with_optional_dup(sample: Sample, output_images: Path, output_labels: Path, index: int):
    suffix = f'_b{index}'
    image_name = f'{sample.image_path.stem}{suffix}{sample.image_path.suffix.lower()}'
    label_name = f'{sample.label_path.stem}{suffix}.txt'

    shutil.copy2(sample.image_path, output_images / image_name)
    shutil.copy2(sample.label_path, output_labels / label_name)


def write_dataset(output_root: Path, train: list[Sample], val: list[Sample], test: list[Sample]):
    if output_root.exists():
        shutil.rmtree(output_root)

    for split in ['train', 'valid', 'test']:
        (output_root / split / 'images').mkdir(parents=True, exist_ok=True)
        (output_root / split / 'labels').mkdir(parents=True, exist_ok=True)

    for idx, sample in enumerate(train):
        _copy_with_optional_dup(sample, output_root / 'train' / 'images', output_root / 'train' / 'labels', idx)
    for idx, sample in enumerate(val):
        _copy_with_optional_dup(sample, output_root / 'valid' / 'images', output_root / 'valid' / 'labels', idx)
    for idx, sample in enumerate(test):
        _copy_with_optional_dup(sample, output_root / 'test' / 'images', output_root / 'test' / 'labels', idx)

    yaml_content = (
        f"path: {output_root.resolve().as_posix()}\n"
        "train: train/images\n"
        "val: valid/images\n"
        "test: test/images\n\n"
        "nc: 5\n"
        "names: ['pothole', 'alligator_crack', 'longitudinal_crack', 'transverse_crack', 'other']\n"
    )
    (output_root / 'data_multiclass.yaml').write_text(yaml_content, encoding='utf-8')


def print_count_table(title: str, counts: dict[int, int]):
    print(f'\n{title}')
    print('-' * len(title))
    total = 0
    for class_id, name in enumerate(CLASS_NAMES):
        count = int(counts.get(class_id, 0))
        total += count
        print(f'{name:<20} {count:>6}')
    print(f"{'TOTAL':<20} {total:>6}")


def main():
    args = parse_args()
    if abs((args.train_ratio + args.val_ratio + args.test_ratio) - 1.0) > 1e-6:
        raise ValueError('train/val/test ratios must sum to 1.0')

    rng = random.Random(args.seed)
    source_root = Path(args.source)
    output_root = Path(args.output)

    base_samples = collect_base_samples(source_root)
    feedback_samples = [] if args.skip_feedback else collect_feedback_samples(source_root)

    merged = []
    seen = set()
    for sample in [*base_samples, *feedback_samples]:
        key = (str(sample.image_path.resolve()), str(sample.label_path.resolve()), sample.class_id)
        if key in seen:
            continue
        seen.add(key)
        merged.append(sample)

    merged_counts = summarize_counts(merged)
    print_count_table('Merged source class distribution', merged_counts)

    target_count = choose_target_count(merged_counts, args.target_per_class)
    print(f'\nTarget per class: {target_count}')
    if target_count <= 0:
        raise RuntimeError('No samples found to build balanced dataset.')

    balanced = build_balanced_pool(merged, target_count=target_count, rng=rng)
    balanced_counts = summarize_counts(balanced)
    print_count_table('Balanced pool class distribution', balanced_counts)

    train, val, test = stratified_split(
        balanced,
        rng=rng,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio
    )

    print(f'\nSplit sizes -> train: {len(train)}, valid: {len(val)}, test: {len(test)}')

    if args.dry_run:
        print('\nDry run complete. No files were written.')
        return

    write_dataset(output_root, train, val, test)
    print(f'\nBalanced dataset written to: {output_root.as_posix()}')
    print(f"Use this for retrain: --data-yaml {output_root.as_posix()}/data_multiclass.yaml")


if __name__ == '__main__':
    main()
