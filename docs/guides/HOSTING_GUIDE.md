# Hosting Guide (Firebase Hosting + Cloud Run)

This guide deploys:
- Frontend (React/Vite) -> Firebase Hosting
- Backend (Flask + YOLO) -> Cloud Run
- Database/Storage -> existing Firebase Firestore + Storage

## 0) One-time prerequisites

Install and verify:
- Google Cloud SDK (`gcloud`)
- Firebase CLI (`firebase`)
- Docker Desktop (or Cloud Build only)

```powershell
gcloud --version
firebase --version
```

## 1) Choose your Google project and region

Use your Firebase project ID for all commands below.

```powershell
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud config set run/region asia-southeast1
```

Enable required APIs:

```powershell
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com firebase.googleapis.com firestore.googleapis.com
```

Create the Docker repository (one-time):

```powershell
gcloud artifacts repositories create roadhazard --repository-format=docker --location=asia-southeast1 --description="RoadHazard backend images"
```

If it already exists, you can ignore the "already exists" message.

Optional check:

```powershell
gcloud artifacts repositories list --location=asia-southeast1
```

## 2) Deploy backend to Cloud Run

From project root:

```powershell
cd C:\Users\Ahmad Hazwan Syauqee\Documents\FYP_RoadHazard
```

Build container image using Cloud Build:

```powershell
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/<YOUR_PROJECT_ID>/roadhazard/roadhazard-api:latest .
```

Deploy to Cloud Run:

```powershell
gcloud run deploy roadhazard-api `
  --image asia-southeast1-docker.pkg.dev/<YOUR_PROJECT_ID>/roadhazard/roadhazard-api:latest `
  --platform managed `
  --region asia-southeast1 `
  --allow-unauthenticated `
  --memory 2Gi `
  --cpu 1 `
  --timeout 300 `
  --set-env-vars MODEL_PATH=/app/runs/detect/road_hazards_multi6/weights/best.pt,FLASK_DEBUG=0,USE_SSL=false,FIREBASE_STORAGE_BUCKET=roadhazard-fyp.firebasestorage.app
```

Get backend URL (keep for verification):

```powershell
gcloud run services describe roadhazard-api --region asia-southeast1 --format="value(status.url)"
```

### Important IAM for Firestore/Storage

If backend logs show Firebase permission errors, grant your Cloud Run runtime service account access:
- Firestore: Cloud Datastore User
- Storage: Storage Object Admin (or narrower scoped role for your bucket)

## 3) Deploy frontend to Firebase Hosting

Install deps + build frontend for production:

```powershell
cd frontend
npm install
npm run build
cd ..
```

Login and initialize Firebase target project if needed:

```powershell
firebase login
firebase use --add
```

Deploy Hosting:

```powershell
firebase deploy --only hosting
```

Your `firebase.json` is preconfigured to:
- Serve `frontend/dist`
- Rewrite `/api/**` to Cloud Run service `roadhazard-api` in `asia-southeast1`
- Rewrite all other routes to `index.html` (SPA routing)

## 4) Verify end-to-end

1. Open your Firebase Hosting URL.
2. Check API health through Hosting rewrite:
   - `https://<your-hosting-domain>/api/health`
3. Submit a report from the app.
4. Confirm:
   - image uploads to Firebase Storage
   - Firestore record appears
   - dashboard loads report from `/api/reports`

## 5) Updates workflow (future)

### Quickest way (recommended)

Use the helper script from project root:

```powershell
# Deploy backend + frontend
.\update_hosting.ps1 -Target all -ProjectId roadhazard-fyp

# Deploy backend only (most common for API/model changes)
.\update_hosting.ps1 -Target backend -ProjectId roadhazard-fyp

# Deploy frontend only
.\update_hosting.ps1 -Target frontend -ProjectId roadhazard-fyp
```

The script automatically applies the current runtime env vars (including auto-retrain settings and cooldown=0) when deploying Cloud Run.

### Backend code/model changes

```powershell
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/<YOUR_PROJECT_ID>/roadhazard/roadhazard-api:latest .
gcloud run deploy roadhazard-api --image asia-southeast1-docker.pkg.dev/<YOUR_PROJECT_ID>/roadhazard/roadhazard-api:latest --region asia-southeast1
```

### Frontend-only changes

```powershell
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

## Notes

- `frontend/.env.production` uses `VITE_API_URL=/api` so frontend calls stay same-origin in production.
- `webapp/app.py` now supports Application Default Credentials, so no local `firebase_credentials.json` is required in Cloud Run.
- Current guide uses `road_hazards_multi6` weights inside the image.

## Report Notes / Evidence Collected

Use this section as direct input for thesis/report documentation.

### Deployment architecture evidence
- Frontend served by Firebase Hosting from `frontend/dist`.
- Backend served by Cloud Run service `roadhazard-api` in `asia-southeast1`.
- Production API routing uses Hosting rewrite `/api/**` to Cloud Run.
- Single-domain behavior is preserved using `VITE_API_URL=/api` in production build.

### Configuration evidence to cite
- `firebase.json` confirms:
   - Hosting public directory: `frontend/dist`
   - API rewrite: `/api/**` → Cloud Run (`roadhazard-api`, `asia-southeast1`)
   - SPA fallback: `**` → `/index.html`
- `webapp/app.py` confirms Firebase initialization supports Application Default Credentials for Cloud Run runtime.

### Validation checklist (recommended for final report)
1. `https://<hosting-domain>/api/health` returns service + Firestore status.
2. Upload test report from hosted frontend succeeds.
3. Image appears in Firebase Storage bucket.
4. Firestore record is created/updated with detection payload.
5. Dashboard lists the new report via hosted `/api/reports` path.

### Current limitations to report transparently
- Final Cloud Run latency and cold-start measurements are not yet logged in this document.
- IAM scope hardening (least privilege) should be finalized after first stable production run.
