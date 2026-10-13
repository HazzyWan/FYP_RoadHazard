param(
    [string]$ProjectId = 'roadhazard-fyp',
    [string]$Region = 'asia-southeast1',
    [string]$Repository = 'roadhazard',
    [string]$PolicyFile = (Join-Path $PSScriptRoot 'artifact_registry_cleanup_policy.json')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw 'gcloud is not installed or not in PATH.'
}

if (-not (Test-Path $PolicyFile)) {
    throw "Policy file not found: $PolicyFile"
}

Write-Host "Setting project: $ProjectId" -ForegroundColor Cyan
gcloud config set project $ProjectId | Out-Host

Write-Host "Applying cleanup policy to Artifact Registry repo '$Repository' in '$Region'..." -ForegroundColor Cyan
gcloud artifacts repositories set-cleanup-policies $Repository `
    --location $Region `
    --policy $PolicyFile `
    --quiet | Out-Host

Write-Host "Verifying cleanup policies..." -ForegroundColor Cyan
gcloud artifacts repositories describe $Repository `
    --location $Region `
    --format="yaml(cleanupPolicies)" | Out-Host

Write-Host "Done." -ForegroundColor Green
