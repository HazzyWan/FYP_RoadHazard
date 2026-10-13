# Algorithm Reference (Academic)

## 1) Detection Normalization Pipeline
**Why:** Raw model labels can be inconsistent for user-facing reporting and retraining consistency.

**Where:** `webapp/app.py`
- `_normalize_label(label, conf)`
- `_normalize_hazard_label(label)`
- `_normalize_dataset_class(label)`

**What it does:**
- Standardizes class names
- Applies confidence-aware crack subtype fallback
- Enforces remap logic (e.g., `other -> crack`)

---

## 2) Multi-Scenario Consensus Scoring
**Why:** Single-condition predictions can be unstable; consensus across scenario perturbations increases robustness.

**Where:** `webapp/app.py`
- `_confidence_summary_from_detections(detections)`
- `_consensus_from_scenarios(scenarios)`
- `_scenario_weight(scenario_name)`

**Core idea:**
1. Run inference per scenario
2. Build class scores (weighted)
3. Select top class by margin and support
4. Collapse uncertain crack subtype predictions to umbrella `crack`

---

## 3) Scenario Augmentation Operators
**Why:** Simulate realistic tropical road conditions and stress-test model behavior.

**Where:** `webapp/app.py`
- `_tropical_aug_sun_glare`
- `_tropical_aug_canopy_shadow`
- `_tropical_aug_monsoon_rain`
- `_tropical_aug_wet_surface`
- `_tropical_aug_fog_haze`
- `_tropical_aug_low_light_noise`

**Inputs:** source image + intensity [0..1] + enabled controls

**Output:** augmented scenario images used for inference confidence analysis

---

## 4) Two-Pass Inference Strategy
**Why:** Improve recovery of weak/low-contrast hazards when first pass finds no valid detections.

**Where:** `webapp/app.py`
- `_enhance_for_second_pass(image_bgr)`
- `_infer_detections_from_bgr(image_bgr)`

**Flow:**
1. First-pass YOLO inference
2. If empty and enabled, apply CLAHE/sharpen enhancement
3. Second-pass inference with adjusted confidence threshold

---

## 5) Feedback-to-Training Sample Generation
**Why:** Close the loop between user corrections and model improvement.

**Where:** `webapp/app.py`
- `_select_feedback_bbox(...)`
- `_write_feedback_sample(...)`
- `/api/feedback_detection`

**Flow:**
1. User submits correction (+ optional target bbox)
2. System selects/validates bbox
3. Writes YOLO label + image into feedback dataset structure
4. Marks entry for retraining pipeline

---

## 6) Dataset Label Count Strategy (Hosted-safe)
**Why:** Cloud runtime may not retain local dataset folders; counts must remain informative.

**Where:** `webapp/app.py`
- `_compute_dataset_label_counts()`
- `/api/dataset_label_counts`

**Fallback order:**
1. Filesystem (`submitted_by_class`)
2. Firestore `training_feedback`
3. Firestore `hazard_records`

This guarantees non-empty count visibility for presentation dashboards.
