import os
import numpy as np
import matplotlib.pyplot as plt
from PIL import Image, ImageFilter
import cv2

os.makedirs('images', exist_ok=True)

# Default image_path — replace with your image if desired
image_path = 'runs/detect/val9/val_batch0_pred.jpg'

def apply_clahe_color(bgr, clip=3.0, tile=(8,8)):
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=tile)
    l2 = clahe.apply(l)
    lab2 = cv2.merge((l2,a,b))
    return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)

def boxes_from_contours(gray, area_min=400):
    cnts, _ = cv2.findContours(gray, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in cnts:
        x,y,w,h = cv2.boundingRect(c)
        if w*h >= area_min:
            boxes.append((x,y,x+w,y+h))
    return boxes

def iou(a,b):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1]); x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2-x1) * max(0, y2-y1)
    area_a = (a[2]-a[0])*(a[3]-a[1])
    area_b = (b[2]-b[0])*(b[3]-b[1])
    union = area_a + area_b - inter
    return inter/union if union>0 else 0.0

def draw_box(ax, box, color='red', linestyle='-'):
    x1,y1,x2,y2 = box
    w = x2-x1; h = y2-y1
    rect = plt.Rectangle((x1,y1), w, h, edgecolor=color, facecolor='none', linewidth=2, linestyle=linestyle)
    ax.add_patch(rect)

# Load image (BGR for OpenCV processing)
if not os.path.exists(image_path):
    raise FileNotFoundError(f'Input image not found: {image_path}')

bgr = cv2.imread(image_path)
if bgr is None:
    raise RuntimeError(f'Failed to load image via cv2: {image_path}')

h, w = bgr.shape[:2]

# Primary pass: simple edge/threshold candidate detection (illustrative)
gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
_, th = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
prim_boxes = boxes_from_contours(th, area_min=int(0.0015*w*h))

# Secondary pass: CLAHE then candidate detection
bgr_clahe = apply_clahe_color(bgr)
gray2 = cv2.cvtColor(bgr_clahe, cv2.COLOR_BGR2GRAY)
_, th2 = cv2.threshold(gray2, 120, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
sec_boxes = boxes_from_contours(th2, area_min=int(0.0015*w*h))

# Consensus: keep primary boxes that have IoU >= 0.3 with any secondary box
consensus = []
for p in prim_boxes:
    if any(iou(p,s) >= 0.3 for s in sec_boxes):
        consensus.append(p)

# Right panel: simulate standing water by heavy smoothing and reduce contrast; run same detector
pil = Image.open(image_path).convert('RGB')
pil_water = pil.filter(ImageFilter.GaussianBlur(radius=8)).point(lambda i: i*0.85)
bgr_water = cv2.cvtColor(np.array(pil_water), cv2.COLOR_RGB2BGR)
gray_w = cv2.cvtColor(bgr_water, cv2.COLOR_BGR2GRAY)
_, th_w = cv2.threshold(gray_w, 120, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
water_boxes = boxes_from_contours(th_w, area_min=int(0.0015*w*h))

# Create figure with three panels (images plotted in image coordinates)
fig, axs = plt.subplots(1,3,figsize=(15,6))
for ax in axs:
    ax.axis('off')

# Left: original with primary (dashed red) and secondary (green) boxes
ax = axs[0]
ax.imshow(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
for b in prim_boxes: draw_box(ax, b, color='red', linestyle='--')
for b in sec_boxes: draw_box(ax, b, color='lime', linestyle='-')
ax.set_title('Primary (dashed red) + Secondary (CLAHE, green)')

# Middle: consensus result (kept detections)
ax = axs[1]
ax.imshow(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
for b in consensus: draw_box(ax, b, color='orange')
ax.set_title(f'Consensus kept {len(consensus)} boxes')

# Right: standing-water simulation (often removes geometric signal)
ax = axs[2]
ax.imshow(pil_water)
for b in water_boxes: draw_box(ax, b, color='blue')
ax.set_title(f'Standing-water sim — detected {len(water_boxes)} boxes')

fig.suptitle('Figure 5.2 — Multi-Pass Edge-Case Confirmations (photo-driven)')
fig.tight_layout(rect=[0,0,1,0.95])
fig.savefig('docs/figures/fig5-2-photo.png', dpi=300, bbox_inches='tight')
fig.savefig('docs/figures/fig5-2-photo.svg', bbox_inches='tight')
plt.close(fig)
print('Saved docs/figures/fig5-2-photo.png and images/fig5-2-photo.svg')
