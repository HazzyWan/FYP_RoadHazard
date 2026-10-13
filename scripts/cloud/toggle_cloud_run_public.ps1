param(
    [ValidateSet('status', 'on', 'off', 'toggle')]
    [string]$Mode = 'status',
    [string]$ProjectId = 'roadhazard-fyp',
    [string]$Region = 'asia-southeast1',
    [string]$ServiceName = 'roadhazard-api'
)

$ErrorActionPreference = 'Stop'

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Is-Public {
    param(
        [string]$Svc,
        [string]$Reg
    )
    $members = gcloud run services get-iam-policy $Svc --region $Reg --format="value(bindings.role,bindings.members)"
    if (-not $members) { return $false }
    return ($members -match 'roles/run.invoker' -and $members -match 'allUsers')
}

Require-Command gcloud

gcloud config set project $ProjectId | Out-Null
gcloud config set run/region $Region | Out-Null

$isPublic = Is-Public -Svc $ServiceName -Reg $Region

if ($Mode -eq 'status') {
    if ($isPublic) {
        Write-Host "Cloud Run service '$ServiceName' is PUBLIC (ON)." -ForegroundColor Green
    } else {
        Write-Host "Cloud Run service '$ServiceName' is PRIVATE (OFF)." -ForegroundColor Yellow
    }
    exit 0
}

if ($Mode -eq 'toggle') {
    if ($isPublic) {
        $Mode = 'off'
    } else {
        $Mode = 'on'
    }
}

if ($Mode -eq 'on') {
    gcloud run services add-iam-policy-binding $ServiceName `
        --region $Region `
        --member="allUsers" `
        --role="roles/run.invoker" | Out-Host
    Write-Host "Public access enabled (ON)." -ForegroundColor Green
}

if ($Mode -eq 'off') {
    gcloud run services remove-iam-policy-binding $ServiceName `
        --region $Region `
        --member="allUsers" `
        --role="roles/run.invoker" | Out-Host
    Write-Host "Public access disabled (OFF)." -ForegroundColor Green
}

$isPublicAfter = Is-Public -Svc $ServiceName -Reg $Region
if ($isPublicAfter) {
    Write-Host "Current state: PUBLIC (ON)." -ForegroundColor Green
} else {
    Write-Host "Current state: PRIVATE (OFF)." -ForegroundColor Yellow
}
