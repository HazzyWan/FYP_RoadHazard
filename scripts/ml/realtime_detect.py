import os
import time
import cv2
import torch
from ultralytics import YOLO

def find_latest_best(root_dir: str = 'runs/detect') -> str | None:
    """Return path to newest best.pt under runs/**/weights, or None if not found."""
    newest = None
    newest_mtime = -1.0
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Look for weights directories and a best.pt inside
        if os.path.basename(dirpath) == 'weights':
            candidate = os.path.join(dirpath, 'best.pt')
            if os.path.isfile(candidate):
                try:
                    mtime = os.path.getmtime(candidate)
                except OSError:
                    mtime = 0.0
                if mtime > newest_mtime:
                    newest_mtime = mtime
                    newest = candidate
    return newest

# Model/device config
_env_model = os.getenv('MODEL_PATH')
if _env_model and os.path.isfile(_env_model):
    MODEL_PATH = _env_model
else:
    MODEL_PATH = find_latest_best() or 'runs/detect/road_hazards_multi/weights/best.pt'

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
CONF_THRESH = 0.25  # lowered for better crack sensitivity

model = YOLO(MODEL_PATH).to(DEVICE)
print(f"Loaded model: {MODEL_PATH} on {DEVICE}")
print("Starting Webcam... Press 'q' to quit.")

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

while True:
    success, frame = cap.read()
    if not success:
        print("Failed to read from camera.")
        break

    # Run detection
    results = model(frame, stream=True, conf=CONF_THRESH, verbose=False)

    for result in results:
        annotated_frame = result.plot()
        cv2.imshow("YOLOv8 Pothole/Crack", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
