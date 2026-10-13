param(
    [ValidateSet('status', 'off', 'on')]
    [string]$Mode = 'status',
    [string]$ProjectId = 'roadhazard-fyp',
    [string]$Region = 'asia-southeast1',
    [string]$ServiceName = 'roadhazard-api',
    [string]$Repository = 'roadhazard'
)

$ErrorActionPreference = 'Stop'

$toggleScript = Join-Path $PSScriptRoot 'toggle_cloud_run_public.ps1'
$artifactScript = Join-Path $PSScriptRoot 'apply_artifact_registry_cleanup.ps1'
$artifactPausePolicy = Join-Path $PSScriptRoot 'artifact_registry_cleanup_policy_pause.json'

if (-not (Test-Path $toggleScript)) {
    throw "Missing script: $toggleScript"
}

if (-not (Test-Path $artifactScript)) {
    throw "Missing script: $artifactScript"
}

if (-not (Test-Path $artifactPausePolicy)) {
    throw "Missing pause cleanup policy: $artifactPausePolicy"
}

if ($Mode -eq 'status') {
    Write-Host "== Maintenance Status ==" -ForegroundColor Cyan
    & $toggleScript -Mode status -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName
    Write-Host "Tip: Run '.\\maintenance_mode.ps1 -Mode off' before long idle periods." -ForegroundColor Yellow
    exit 0
}

if ($Mode -eq 'off') {
    Write-Host "== Entering Maintenance Mode ==" -ForegroundColor Cyan
    Write-Host "1) Turning Cloud Run public access OFF" -ForegroundColor Gray
    & $toggleScript -Mode off -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName

    Write-Host "2) Applying strict Artifact Registry pause policy" -ForegroundColor Gray
    & $artifactScript -ProjectId $ProjectId -Region $Region -Repository $Repository -PolicyFile $artifactPausePolicy

    Write-Host "Maintenance mode ON (public API OFF + strict Artifact Registry retention)." -ForegroundColor Green
    exit 0
}

if ($Mode -eq 'on') {
    Write-Host "== Exiting Maintenance Mode ==" -ForegroundColor Cyan
    Write-Host "Turning Cloud Run public access ON" -ForegroundColor Gray
    & $toggleScript -Mode on -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName

    Write-Host "Maintenance mode OFF (public API ON)." -ForegroundColor Green
    exit 0
}
