param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',
    [string]$ProjectId = 'roadhazard-fyp',
    [string]$Region = 'asia-southeast1',
    [string]$ServiceName = 'roadhazard-api',
    [string]$ImageTag = 'latest',
    [string]$ModelPath = '/app/runs/detect/road_hazards_multi6/weights/best.pt',
    [string]$SmtpPassword = ''
)

$ErrorActionPreference = 'Stop'

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Invoke-Step {
    param(
        [string]$Title,
        [scriptblock]$Action
    )
    Write-Host "`n=== $Title ===" -ForegroundColor Cyan
    & $Action
}

function Assert-LastExitCode {
    param([string]$StepName)
    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed (exit code $LASTEXITCODE)."
    }
}

Require-Command gcloud
if ($Target -eq 'all' -or $Target -eq 'frontend') {
    Require-Command firebase
    Require-Command npm
}

$projectRoot = $PSScriptRoot
$imageUri = "$Region-docker.pkg.dev/$ProjectId/roadhazard/roadhazard-api:$ImageTag"
. (Join-Path $projectRoot 'scripts\Import-LocalSecrets.ps1')
$Secrets = Import-LocalSecrets
if (-not $SmtpPassword) {
    $SmtpPassword = (Get-Item Env:RH_SMTP_PASSWORD -ErrorAction SilentlyContinue).Value
}
if (-not $SmtpPassword) {
    $SmtpPassword = $Secrets.SMTP_PASSWORD
}

if (($Target -eq 'all' -or $Target -eq 'backend') -and [string]::IsNullOrWhiteSpace($SmtpPassword)) {
    throw "SMTP password is required for backend deploy because AUTO_REPAIR_EMAIL_ENABLED=true. Set SMTP_PASSWORD in secrets.local.env, pass -SmtpPassword, or set RH_SMTP_PASSWORD."
}

if ($Target -eq 'all' -or $Target -eq 'backend') {
    Invoke-Step "Check active gcloud account" {
        $activeAccount = (gcloud auth list --filter=status:ACTIVE --format="value(account)").Trim()
        if (-not $activeAccount) {
            throw "No active gcloud account. Run: gcloud auth login"
        }
        Write-Host "Using gcloud account: $activeAccount" -ForegroundColor Green
    }

    Invoke-Step "Configure gcloud project and region" {
        gcloud config set project $ProjectId | Out-Host
        Assert-LastExitCode "gcloud config set project"
        gcloud config set run/region $Region | Out-Host
        Assert-LastExitCode "gcloud config set run/region"
    }

    Invoke-Step "Enable required Google APIs" {
        gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com | Out-Host
        Assert-LastExitCode "gcloud services enable"
    }

    Invoke-Step "Ensure Artifact Registry repository exists" {
        $existingRepo = (gcloud artifacts repositories list --location $Region --project $ProjectId --format="value(name)" | Where-Object {
            ($_ -eq 'roadhazard') -or ($_ -like "*/repositories/roadhazard")
        })
        Assert-LastExitCode "gcloud artifacts repositories list"
        $repoExists = -not [string]::IsNullOrWhiteSpace(($existingRepo -join ''))

        if (-not $repoExists) {
            Write-Host "Artifact Registry repo 'roadhazard' not found. Creating..." -ForegroundColor Yellow
            gcloud artifacts repositories create roadhazard `
                --repository-format=docker `
                --location=$Region `
                --project=$ProjectId `
                --description="RoadHazard backend images" | Out-Host
            Assert-LastExitCode "gcloud artifacts repositories create"
        } else {
            Write-Host "Artifact Registry repo 'roadhazard' already exists." -ForegroundColor Green
        }
    }

    Invoke-Step "Build backend container image" {
        Set-Location $projectRoot
        gcloud builds submit --tag $imageUri . | Out-Host
        Assert-LastExitCode "gcloud builds submit"
    }

    Invoke-Step "Deploy backend to Cloud Run" {
        $envVars = @(
            "MODEL_PATH=$ModelPath"
            "FLASK_DEBUG=0"
            "FLASK_SECRET_KEY=$($Secrets.FLASK_SECRET_KEY)"
            "USE_SSL=false"
            "SESSION_COOKIE_SECURE=true"
            "SESSION_COOKIE_SAMESITE=None"
            "FIREBASE_STORAGE_BUCKET=roadhazard-fyp.firebasestorage.app"
            "ADMIN_LOGIN_EMAIL=$($Secrets.ADMIN_LOGIN_EMAIL)"
            "ADMIN_LOGIN_PASSWORD=$($Secrets.ADMIN_LOGIN_PASSWORD)"
            "DEFAULT_CONTRACTOR_EMAIL=roadhazard.contractor@gmail.com"
            "AUTO_REPAIR_EMAIL_ENABLED=true"
            "SMTP_HOST=smtp.gmail.com"
            "SMTP_PORT=587"
            "SMTP_USE_TLS=true"
            "SMTP_USERNAME=roadhazard.sender@gmail.com"
            "SMTP_PASSWORD=$SmtpPassword"
            "SMTP_FROM=roadhazard.sender@gmail.com"
            "REPORTER_UPDATE_EMAIL_ENABLED=true"
            "REPORTER_UPDATE_SMS_ENABLED=false"
            "TWILIO_ACCOUNT_SID="
            "TWILIO_AUTH_TOKEN="
            "TWILIO_FROM_NUMBER="
            "PUBLIC_BASE_URL=https://roadhazard-fyp.web.app"
            "INFER_CONF=0.25"
            "INFER_IOU=0.45"
            "INFER_REMAP_OTHER_TO_CRACK=true"
            "INFER_CLASSES="
            "INFER_POTHOLE_LINEAR_MAX_BASE_CONF=0.72"
            "INFER_POTHOLE_LINEAR_MIN_ASPECT=1.80"
            "AUTO_RETRAIN_ON_FEEDBACK=true"
            "AUTO_RETRAIN_MIN_FEEDBACK=10"
            "AUTO_RETRAIN_COOLDOWN_MIN=0"
            "AUTO_RETRAIN_EPOCHS=20"
            "AUTO_RETRAIN_BATCH=4"
            "AUTO_RETRAIN_IMGSZ=512"
            "AUTO_RETRAIN_RESUME=true"
            "AUTO_RETRAIN_RUNNING_GRACE_MIN=10"
            "REPORTS_BACKFILL_ON_READ=true"
            "REPORTS_BACKFILL_MAX_PER_REQUEST=3"
            "UPLOAD_REVERSE_GEOCODE_ON_SUBMIT=true"
            "UPLOAD_ARCHIVE_ON_SUBMIT=false"
        ) -join ','

        gcloud run deploy $ServiceName `
            --image $imageUri `
            --platform managed `
            --region $Region `
            --allow-unauthenticated `
            --memory 4Gi `
            --cpu 2 `
            --concurrency 2 `
            --timeout 900 `
            --set-env-vars $envVars | Out-Host
        Assert-LastExitCode "gcloud run deploy"
    }

    Invoke-Step "Backend URL" {
        $backendUrl = gcloud run services describe $ServiceName --region $Region --format="value(status.url)"
        Write-Host "Cloud Run service URL: $backendUrl" -ForegroundColor Green
        Write-Host "Retrain status endpoint: $backendUrl/api/retrain_status" -ForegroundColor Green
    }
}

if ($Target -eq 'all' -or $Target -eq 'frontend') {
    Invoke-Step "Build frontend" {
        Set-Location (Join-Path $projectRoot 'frontend')
        npm run build | Out-Host
    }

    Invoke-Step "Deploy frontend to Firebase Hosting" {
        Set-Location $projectRoot
        firebase deploy --only hosting --project $ProjectId | Out-Host
    }
}

Write-Host "`nDone. Target '$Target' deployed for project '$ProjectId'." -ForegroundColor Green
