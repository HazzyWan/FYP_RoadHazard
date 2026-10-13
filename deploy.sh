#!/bin/bash

# Deployment script for RoadHazard project
TARGET=${1:-all}
PROJECT_ID=${2:-roadhazard-fyp}
REGION=${3:-asia-southeast1}
SERVICE_NAME=${4:-roadhazard-api}
IMAGE_TAG=${5:-latest}
MODEL_PATH=${6:-/app/runs/detect/road_hazards_multi6/weights/best.pt}

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
# Load secrets (ADMIN_LOGIN_*, FLASK_SECRET_KEY, SMTP_PASSWORD) from the git-ignored local file
[[ -f "$PROJECT_ROOT/secrets.local.env" ]] || { echo "Missing secrets.local.env (copy secrets.example.env)"; exit 1; }
while IFS='=' read -r key value; do [[ $key =~ ^[A-Z_]+$ ]] && export "$key=${value%$'\r'}"; done < "$PROJECT_ROOT/secrets.local.env"

IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT_ID/roadhazard/roadhazard-api:$IMAGE_TAG"

echo "=== Deploying RoadHazard - Target: $TARGET ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Image: $IMAGE_URI"

# Configure gcloud
echo ""
echo "=== Configuring gcloud ==="
gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION

if [[ "$TARGET" == "all" ]] || [[ "$TARGET" == "backend" ]]; then
    echo ""
    echo "=== Building backend container image ==="
    cd "$PROJECT_ROOT"
    gcloud builds submit --tag $IMAGE_URI .
    
    echo ""
    echo "=== Deploying backend to Cloud Run ==="
    gcloud run deploy $SERVICE_NAME \
        --image $IMAGE_URI \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --memory 2Gi \
        --cpu 1 \
        --timeout 300 \
        --set-env-vars "MODEL_PATH=$MODEL_PATH,FLASK_DEBUG=0,FLASK_SECRET_KEY=$FLASK_SECRET_KEY,USE_SSL=false,SESSION_COOKIE_SECURE=true,FIREBASE_STORAGE_BUCKET=roadhazard-fyp.firebasestorage.app,ADMIN_LOGIN_EMAIL=$ADMIN_LOGIN_EMAIL,ADMIN_LOGIN_PASSWORD=$ADMIN_LOGIN_PASSWORD,DEFAULT_CONTRACTOR_EMAIL=roadhazard.contractor@gmail.com,AUTO_REPAIR_EMAIL_ENABLED=false,SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USE_TLS=true,SMTP_USERNAME=roadhazard.sender@gmail.com,SMTP_PASSWORD=,SMTP_FROM=roadhazard.sender@gmail.com,REPORTER_UPDATE_EMAIL_ENABLED=true,REPORTER_UPDATE_SMS_ENABLED=false,TWILIO_ACCOUNT_SID=,TWILIO_AUTH_TOKEN=,TWILIO_FROM_NUMBER=,INFER_CONF=0.25,INFER_IOU=0.45,INFER_REMAP_OTHER_TO_CRACK=true,INFER_CLASSES=,INFER_POTHOLE_LINEAR_MAX_BASE_CONF=0.72,INFER_POTHOLE_LINEAR_MIN_ASPECT=1.80,INFER_ENABLE_SECOND_PASS=true,INFER_SECOND_PASS_CLAHE=true,INFER_SECOND_PASS_CONF=0.18,INFER_CRACK_SUBTYPE_MIN_CONF=0.66,INFER_CRACK_BBOX_REFINEMENT_ENABLED=true,INFER_CRACK_BBOX_REFINEMENT_MIN_AREA_RATIO=0.04,INFER_CRACK_BBOX_REFINEMENT_MAX_AREA_RATIO=0.82,INFER_CRACK_RELOCALIZE_ENABLED=true,INFER_CRACK_RELOCALIZE_MIN_IMAGE_AREA=0.26,INFER_CRACK_RELOCALIZE_MAX_AREA_RATIO=0.72,INFER_CRACK_RELOCALIZE_CONF=0.16,INFER_FEEDBACK_GUIDANCE_ENABLED=true,AUTO_RETRAIN_ON_FEEDBACK=true,AUTO_RETRAIN_MIN_FEEDBACK=10,AUTO_RETRAIN_COOLDOWN_MIN=0,AUTO_RETRAIN_EPOCHS=20,AUTO_RETRAIN_BATCH=4,AUTO_RETRAIN_IMGSZ=512,AUTO_RETRAIN_RESUME=true,AUTO_RETRAIN_RUNNING_GRACE_MIN=10,SCENARIO_CONSENSUS_MIN_MARGIN=0.12,SCENARIO_CONSENSUS_MIN_SCORE=0.52,SCENARIO_ORIGINAL_WEIGHT=0.95,REPORTS_BACKFILL_ON_READ=false,REPORTS_BACKFILL_MAX_PER_REQUEST=3"
    
    echo ""
    echo "=== Backend URL ==="
    BACKEND_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")
    echo "Cloud Run service URL: $BACKEND_URL"
    echo "Retrain status endpoint: $BACKEND_URL/api/retrain_status"
fi

if [[ "$TARGET" == "all" ]] || [[ "$TARGET" == "frontend" ]]; then
    echo ""
    echo "=== Building frontend ==="
    cd "$PROJECT_ROOT/frontend"
    npm run build
    
    echo ""
    echo "=== Deploying frontend to Firebase Hosting ==="
    cd "$PROJECT_ROOT"
    firebase deploy --only hosting --project $PROJECT_ID
fi

echo ""
echo "=== Done! Target '$TARGET' deployed for project '$PROJECT_ID'. ==="
