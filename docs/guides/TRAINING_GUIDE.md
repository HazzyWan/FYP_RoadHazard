# Multi-Class Training Quick Start Guide

## What Was Done

✅ **Combined two datasets:**
- Malaysian pothole dataset (60%, 665 images)
- New crack+pothole dataset (40%, 3,653 images)
- **Result:** 4,318 images in `datasets/road_hazards_combined/`

✅ **Smart class remapping:**
- Malaysian potholes (class 0) → stays as pothole (class 0)
- New cracks (class 0) → becomes crack (class 1)
- New potholes (class 1) → becomes pothole (class 0)

✅ **Efficient merging:**
- Used hardlinks for images (~650 MB instead of 4.3 GB)
- All labels automatically remapped
- Train/valid/test splits preserved

---

## Directory Structure Created

```
datasets/
  road_hazards_combined/          ← NEW COMBINED DATASET
    data.yaml                      ← Config (2 classes)
    train/
      images/                      ← 3,026 images
      labels/
    valid/
      images/                      ← 862 images
      labels/
    test/
      images/                      ← 430 images
      labels/
```

---

## Training the Model

### Quick Start (Default Settings)
```bash
python train_multi_class.py
# Trains for 100 epochs with batch size 16
```

### Custom Configuration
```bash
# High accuracy (more epochs, bigger batch)
python train_multi_class.py --epochs 150 --batch 32

# Faster training (fewer epochs, smaller batch)
python train_multi_class.py --epochs 50 --batch 8

# Custom image size (smaller = faster but less accurate)
python train_multi_class.py --imgsz 416

# Resume from checkpoint
python train_multi_class.py --resume

# Use CPU only (for GPU errors)
python train_multi_class.py --device -1
```

### Expected Training Output
```
Training for 100 epochs...
  Epoch 1/100: loss=0.45, val_loss=0.42, mAP=0.65
  Epoch 2/100: loss=0.40, val_loss=0.38, mAP=0.72
  ...
  Epoch 100/100: loss=0.15, val_loss=0.18, mAP=0.88

Best model saved to: runs/detect/road_hazards_multi/weights/best.pt
```

---

## Using the Trained Model

### Inference in Python
```python
from ultralytics import YOLO

# Load model
model = YOLO('runs/detect/road_hazards_multi/weights/best.pt')

# Predict on image
results = model.predict(source='path/to/image.jpg')

# Extract detections
for r in results:
    for box in r.boxes:
        class_id = int(box.cls)
        class_name = model.names[class_id]  # 'pothole' or 'crack'
        confidence = float(box.conf)
        print(f"{class_name}: {confidence:.2%}")
```

### Classes
```
0 = pothole
1 = crack
```

---

## Dataset Stats

### Source Breakdown
| Source | Images | Purpose |
|--------|--------|---------|
| Malaysian | 665 | Potholes (class 0) |
| New Dataset | 3,653 | Cracks (class 1) + Potholes (class 0) |
| **Combined** | **4,318** | Multi-class training |

### Split Breakdown
| Split | Train | Valid | Test |
|-------|-------|-------|------|
| Count | 3,026 | 862   | 430  |
| % | 70% | 20% | 10% |

---

## Backend Integration (Next Steps)

### Update Flask to detect both classes
Edit `webapp/app.py`:

```python
HAZARD_CLASSES = {0: 'pothole', 1: 'crack'}

# In the detection loop:
for detection in results:
    class_id = int(detection.cls)
    class_name = HAZARD_CLASSES.get(class_id, 'unknown')
    detections.append({
        "class": class_name,
        "confidence": float(detection.conf)
    })
```

### Update Dashboard
Edit `frontend/src/components/Dashboard.jsx`:

```jsx
// Add color coding per hazard type
const getHazardColor = (hazardType) => {
  return hazardType === 'pothole' ? 'danger' : 'warning';
};

// Display different icons per type
const getHazardIcon = (hazardType) => {
  return hazardType === 'pothole' ? '🕳️' : '🔓';
};
```

---

## Troubleshooting

### Out of Memory Error
```bash
# Reduce batch size
python train_multi_class.py --batch 8

# Reduce image size
python train_multi_class.py --imgsz 416
```

### Training Too Slow
```bash
# Check if GPU is being used (look for "device=0" in output)
# If not using GPU, training will be very slow
python train_multi_class.py --device 0  # Force GPU
```

### Model Not Converging
```bash
# Train longer with patience
python train_multi_class.py --epochs 200

# Adjust learning rate or other hyperparameters
```

---

## Model Comparison

### Old Model (Pothole-Only)
```
Classes: 1 (pothole)
Dataset: 665 images (Malaysian only)
Performance: Good at detecting potholes, ignores cracks
```

### New Model (Multi-Class)
```
Classes: 2 (pothole + crack)
Dataset: 4,318 images (Malaysian + New)
Performance: Detects both hazard types
```

---

## Questions?

Refer to `DEVELOPMENT_LOG.md` Session 4 for detailed technical notes on:
- Dataset merge algorithm
- Class remapping logic
- Hardlink vs copy performance
- Backend integration examples
