# Operations Commands (Quick Reference)

Use this file as your copy-paste command guide for hosting on/off, cleanup, and cost control.
Run all commands from the project root. Scripts live under `scripts/cloud/` and `scripts/firebase/`.

## 1) Cloud Run Public Access Toggle (API ON/OFF)

Script: `toggle_cloud_run_public.ps1`

```powershell
# Check current state
.\scripts\cloud\toggle_cloud_run_public.ps1 -Mode status

# Public API ON
.\scripts\cloud\toggle_cloud_run_public.ps1 -Mode on

# Public API OFF
.\scripts\cloud\toggle_cloud_run_public.ps1 -Mode off

# Flip state (ON -> OFF, OFF -> ON)
.\scripts\cloud\toggle_cloud_run_public.ps1 -Mode toggle
```

When OFF: hosted frontend can still load, but `/api/*` calls are blocked publicly.

Note: `-Mode off` now applies a strict Artifact Registry pause policy (`artifact_registry_cleanup_policy_pause.json`) for local-only periods.

## 2) One-Script Maintenance Mode

Script: `maintenance_mode.ps1`

```powershell
# Check status
.\scripts\cloud\maintenance_mode.ps1 -Mode status

# Enter maintenance mode: API OFF + apply artifact cleanup policy
.\scripts\cloud\maintenance_mode.ps1 -Mode off

# Exit maintenance mode: API ON
.\scripts\cloud\maintenance_mode.ps1 -Mode on
```

## 3) Artifact Registry Cleanup Policy

Policy file: `artifact_registry_cleanup_policy.json`
Apply script: `apply_artifact_registry_cleanup.ps1`

Strict pause policy file: `artifact_registry_cleanup_policy_pause.json`

```powershell
.\scripts\cloud\apply_artifact_registry_cleanup.ps1
```

Direct command (if needed):

```powershell
gcloud config set project roadhazard-fyp
gcloud artifacts repositories set-cleanup-policies roadhazard --location=asia-southeast1 --policy=scripts/cloud/artifact_registry_cleanup_policy.json --quiet
gcloud artifacts repositories describe roadhazard --location=asia-southeast1 --format="yaml(cleanupPolicies)"
```

Apply strict pause policy directly:

```powershell
gcloud config set project roadhazard-fyp
gcloud artifacts repositories set-cleanup-policies roadhazard --location=asia-southeast1 --policy=scripts/cloud/artifact_registry_cleanup_policy_pause.json --quiet
gcloud artifacts repositories describe roadhazard --location=asia-southeast1 --format="yaml(cleanupPolicies)"
```

Immediate zero-storage option (most aggressive):

```powershell
gcloud config set project roadhazard-fyp
gcloud artifacts repositories delete roadhazard --location=asia-southeast1 --quiet
```

Recreate repository later (before next deploy):

```powershell
gcloud config set project roadhazard-fyp
gcloud artifacts repositories create roadhazard --repository-format=docker --location=asia-southeast1 --description="RoadHazard deploy images"
```

## 4) Firebase Storage Image Cleanup

Script: `cleanup_hazards_storage.py`

```powershell
# Dry-run: older than 180 days
venv\Scripts\python.exe scripts\firebase\cleanup_hazards_storage.py --days 180

# Apply deletion + remove linked Firestore records
venv\Scripts\python.exe scripts\firebase\cleanup_hazards_storage.py --days 180 --apply --delete-firestore-records

# Keep newest 200 files only (dry-run)
venv\Scripts\python.exe scripts\firebase\cleanup_hazards_storage.py --keep-latest 200

# Keep newest 200 files only (apply)
venv\Scripts\python.exe scripts\firebase\cleanup_hazards_storage.py --keep-latest 200 --apply --delete-firestore-records
```

## 5) Bucket Lifecycle Policy (Auto-delete old hazards photos)

Policy file: `storage.lifecycle.json`

```powershell
gcloud storage buckets update gs://roadhazard-fyp.firebasestorage.app --lifecycle-file=scripts/cloud/storage.lifecycle.json
```

Current lifecycle intent: delete files under `hazards/` older than 180 days.

## 6) Recommended Routine

1. Before long idle period: run `.\scripts\cloud\maintenance_mode.ps1 -Mode off`
2. Before demo/use: run `.\scripts\cloud\maintenance_mode.ps1 -Mode on`
3. Weekly: run `cleanup_hazards_storage.py` in dry-run, then apply if needed.
