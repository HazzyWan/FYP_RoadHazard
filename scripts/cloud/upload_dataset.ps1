# Upload dataset to GCS and configure Cloud Run
$ErrorActionPreference = 'Stop'
$project = gcloud config get-value project
if (-not $project) {
  Write-Host "No gcloud project set. Run 'gcloud config set project <PROJECT>' and retry." -ForegroundColor Red
  exit 1
}
$timestamp = Get-Date -Format yyyyMMddHHmmss
$bucket = "roadhazard-dataset-$timestamp"
Write-Host "Project: $project"
Write-Host "Creating bucket: gs://$bucket"
gcloud storage buckets create "gs://$bucket" --location=asia-southeast1 --uniform-bucket-level-access

$datasetPath = "datasets/road_hazards_combined/submitted_by_class"
if (-not (Test-Path $datasetPath)) {
  Write-Host "Local dataset path $datasetPath not found. Aborting upload." -ForegroundColor Red
  exit 1
}

Write-Host "Uploading $datasetPath to gs://$bucket/road_hazards_combined/ (this can take time)"
gsutil -m cp -r $datasetPath "gs://$bucket/road_hazards_combined/"

Write-Host "Fetching Cloud Run service account for roadhazard-api"
$sa = gcloud run services describe roadhazard-api --region=asia-southeast1 --platform=managed --format='value(spec.template.spec.serviceAccountName)'
if (-not $sa) {
  Write-Host "Could not find Cloud Run service 'roadhazard-api' in region asia-southeast1. Skipping IAM binding and env update." -ForegroundColor Yellow
  Write-Host "Please set DATASET_GCS_BUCKET=$bucket manually in Cloud Run if needed."
  Write-Host "Done. Bucket: gs://$bucket"
  exit 0
}

if ($sa -like '*@*') { $sa_email = $sa } else { $sa_email = "$sa@$project.iam.gserviceaccount.com" }
Write-Host "Service account: $sa_email"

Write-Host "Granting Storage Object Viewer to service account: $sa_email"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$sa_email" --role="roles/storage.objectViewer" | Out-Null

Write-Host "Updating Cloud Run service env var DATASET_GCS_BUCKET=$bucket"
gcloud run services update roadhazard-api --region=asia-southeast1 --update-env-vars DATASET_GCS_BUCKET=$bucket | Out-Null

Write-Host "Upload and configuration complete. Bucket: gs://$bucket" -ForegroundColor Green
