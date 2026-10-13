#!/usr/bin/env python3
"""Aggregate an existing confusion matrix (n x n) into the canonical 3-class taxonomy.

Search order:
 - runs/detect/*/confusion_matrix.npy
 - runs/detect/*/confusion_matrix.csv

Outputs:
 - images/fig4-7-confusion-3class.csv
 - images/fig4-7-confusion-3class.png

Run:
    python scripts/report/aggregate_confusion.py --run runs/detect/road_hazards_multi3

"""
import argparse
import os
import glob
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

DEFAULT_RUN = 'runs/detect/road_hazards_multi3'

# Production class order
PROD_CLASSES = ['pothole', 'crack', 'other']

# Mapping from dataset names to prod classes
MAP = {
    'pothole': 'pothole',
    'alligator_crack': 'crack',
    'longitudinal_crack': 'crack',
    'transverse_crack': 'crack',
    'other': 'other',
    # legacy or alternate names
    'debris': 'other',
}


def find_confusion(run_dir):
    npy = os.path.join(run_dir, 'confusion_matrix.npy')
    csv = os.path.join(run_dir, 'confusion_matrix.csv')
    if os.path.exists(npy):
        return np.load(npy), None
    if os.path.exists(csv):
        df = pd.read_csv(csv, header=None)
        return df.values, None
    # fallback: try pattern
    matches = glob.glob(os.path.join(run_dir, '*confusion*'))
    for m in matches:
        if m.endswith('.npy'):
            return np.load(m), None
        if m.endswith('.csv'):
            return pd.read_csv(m, header=None).values, None
    raise FileNotFoundError(f'No confusion matrix found in {run_dir}')


def aggregate_matrix(mat, src_labels):
    # src_labels: list of label names in order corresponding to mat rows/cols
    n = len(PROD_CLASSES)
    agg = np.zeros((n, n), dtype=float)
    for i, li in enumerate(src_labels):
        for j, lj in enumerate(src_labels):
            vi = mat[i, j]
            ti = MAP.get(li, 'other')
            tj = MAP.get(lj, 'other')
            agg[PROD_CLASSES.index(ti), PROD_CLASSES.index(tj)] += vi
    return agg


def plot_matrix(mat, labels, out_png):
    fig, ax = plt.subplots(figsize=(5,5))
    im = ax.imshow(mat, cmap='YlGn', vmin=0, vmax=mat.max() if mat.max()>0 else 1)
    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            ax.text(j, i, int(mat[i,j]), ha='center', va='center', color='black', fontsize=10, fontweight='bold')
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45)
    ax.set_yticklabels(labels)
    ax.set_xlabel('Predicted')
    ax.set_ylabel('Actual')
    ax.set_title('Aggregated confusion matrix (3-class)')
    fig.tight_layout()
    fig.savefig(out_png, dpi=300)
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default=DEFAULT_RUN, help='run folder to read confusion from')
    parser.add_argument('--out-csv', default='images/fig4-7-confusion-3class.csv')
    parser.add_argument('--out-png', default='images/fig4-7-confusion-3class.png')
    args = parser.parse_args()

    os.makedirs('images', exist_ok=True)
    mat, _ = find_confusion(args.run)

    # Try to locate src labels from data yaml
    # fallback: try to load names from datasets/road_hazards_combined/data_multiclass.yaml
    labels = None
    try:
        import yaml
        yaml_path = 'datasets/road_hazards_combined/data_multiclass.yaml'
        if os.path.exists(yaml_path):
            with open(yaml_path, 'r') as f:
                d = yaml.safe_load(f)
                labels = d.get('names')
    except Exception:
        labels = None

    if labels is None:
        # If we cannot find labels, assume common order present in the dataset files
        labels = ['pothole', 'alligator_crack', 'longitudinal_crack', 'transverse_crack', 'other']

    agg = aggregate_matrix(mat, labels)
    pd.DataFrame(agg, index=PROD_CLASSES, columns=PROD_CLASSES).to_csv(args.out_csv)
    plot_matrix(agg, PROD_CLASSES, args.out_png)
    print('Wrote', args.out_csv, args.out_png)
