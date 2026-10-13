param(
    [ValidateSet('localhost', 'lan')]
    [string]$Mode = 'localhost',
    [string]$LanIp = "",
    [int]$FrontendPort = 5173
)

function Get-ActiveLanIp {
    try {
        $cfg = Get-NetIPConfiguration |
            Where-Object { $null -ne $_.IPv4DefaultGateway -and $null -ne $_.IPv4Address } |
            Select-Object -First 1

        if (-not $cfg) { return $null }

        $ip = $cfg.IPv4Address.IPAddress
        if (-not $ip) { return $null }

        if ($ip -match '^10\.' -or $ip -match '^192\.168\.' -or $ip -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.') {
            return $ip
        }

        return $null
    }
    catch {
        return $null
    }
}

$ProjectRoot = $PSScriptRoot
. (Join-Path $ProjectRoot 'scripts\Import-LocalSecrets.ps1')
$Secrets = Import-LocalSecrets
$WebappDir = Join-Path $ProjectRoot "webapp"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$PythonExe = Join-Path $ProjectRoot "venv\Scripts\python.exe"
$detectDir = Join-Path $ProjectRoot "runs\detect"
$modelCandidates = @()
if (Test-Path $detectDir) {
    $modelCandidates = @(Get-ChildItem -Path $detectDir -Directory -Filter "road_hazards_multi*" |
        ForEach-Object { Join-Path $_.FullName "weights\best.pt" } |
        Where-Object { Test-Path $_ } |
        Sort-Object { (Get-Item $_).LastWriteTime } -Descending)
}

if ($modelCandidates.Count -gt 0) {
    $ModelPath = @($modelCandidates)[0]
}
else {
    $ModelPath = Join-Path $ProjectRoot "runs\detect\road_hazards_multi\weights\best.pt"
}
$FrontendScheme = 'https'

if ($Mode -eq 'lan') {
    if ([string]::IsNullOrWhiteSpace($LanIp)) {
        $LanIp = Get-ActiveLanIp
    }
    if ([string]::IsNullOrWhiteSpace($LanIp)) {
        Write-Host "Could not auto-detect LAN IP. Provide it manually with -LanIp." -ForegroundColor Red
        Write-Host "Example: .\start_all.ps1 -Mode lan -LanIp 192.168.0.11" -ForegroundColor Yellow
        exit 1
    }

    $ApiHost = $LanIp
    $ApiScheme = 'https'
    $CertPath = Join-Path $ProjectRoot "certs\$LanIp+2.pem"
    $KeyPath = Join-Path $ProjectRoot "certs\$LanIp+2-key.pem"
    $FrontendScheme = 'https'
}
else {
    $ApiHost = 'localhost'
    $ApiScheme = 'http'
    $CertPath = $null
    $KeyPath = $null
    $FrontendScheme = 'http'
}

$ApiUrl = "${ApiScheme}://$ApiHost`:5000/api"
$PublicBaseUrl = "${ApiScheme}://$ApiHost`:5000"
$FrontendHost = if ($Mode -eq 'lan') { $LanIp } else { 'localhost' }
$FrontendUrl = "${FrontendScheme}://$FrontendHost`:$FrontendPort"

$requiredPaths = @($WebappDir, $FrontendDir, $PythonExe, $ModelPath)
if ($Mode -eq 'lan') {
    $requiredPaths += @($CertPath, $KeyPath)
}
$missing = $requiredPaths | Where-Object { -not (Test-Path $_) }
if ($missing.Count -gt 0) {
    Write-Host "Missing required paths:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    Write-Host "Fix the paths above, then run this script again." -ForegroundColor Yellow
    exit 1
}

$backendCmd = @"
Set-Location '$WebappDir'
`$env:USE_SSL='$([string]($Mode -eq 'lan')).ToLower()'
`$env:SSL_CERT='$CertPath'
`$env:SSL_KEY='$KeyPath'
`$env:MODEL_PATH='$ModelPath'
`$env:INFER_CONF='0.25'
`$env:INFER_IOU='0.45'
`$env:INFER_CLASS_CONF='{"pothole":0.40,"alligator_crack":0.24,"longitudinal_crack":0.24,"other":0.30}'
`$env:INFER_ENABLE_SECOND_PASS='true'
`$env:INFER_SECOND_PASS_CLAHE='true'
`$env:INFER_SECOND_PASS_CONF='0.18'
`$env:INFER_CRACK_SUBTYPE_MIN_CONF='0.66'
`$env:INFER_CRACK_BBOX_REFINEMENT_ENABLED='true'
`$env:INFER_CRACK_BBOX_REFINEMENT_MIN_AREA_RATIO='0.04'
`$env:INFER_CRACK_BBOX_REFINEMENT_MAX_AREA_RATIO='0.82'
`$env:INFER_CRACK_RELOCALIZE_ENABLED='true'
`$env:INFER_CRACK_RELOCALIZE_MIN_IMAGE_AREA='0.26'
`$env:INFER_CRACK_RELOCALIZE_MAX_AREA_RATIO='0.72'
`$env:INFER_CRACK_RELOCALIZE_CONF='0.16'
`$env:INFER_FEEDBACK_GUIDANCE_ENABLED='true'
`$env:SCENARIO_CONSENSUS_MIN_MARGIN='0.12'
`$env:SCENARIO_CONSENSUS_MIN_SCORE='0.52'
`$env:SCENARIO_ORIGINAL_WEIGHT='0.95'
`$env:AUGMENT_INCLUDE_CONFIDENCE='true'
`$env:INFER_CLASSES=''
`$env:INFER_POTHOLE_LINEAR_MAX_BASE_CONF='0.72'
`$env:INFER_POTHOLE_LINEAR_MIN_ASPECT='1.80'
`$env:AUTO_RETRAIN_ON_FEEDBACK='true'
`$env:AUTO_RETRAIN_MIN_FEEDBACK='10'
`$env:AUTO_RETRAIN_COOLDOWN_MIN='0'
`$env:AUTO_RETRAIN_EPOCHS='20'
`$env:AUTO_RETRAIN_BATCH='4'
`$env:AUTO_RETRAIN_IMGSZ='512'
`$env:UPLOAD_REVERSE_GEOCODE_ON_SUBMIT='true'
`$env:REPORTS_BACKFILL_ON_READ='true'
`$env:FLASK_DEBUG='0'
`$env:ADMIN_LOGIN_EMAIL='$($Secrets.ADMIN_LOGIN_EMAIL)'
`$env:ADMIN_LOGIN_PASSWORD='$($Secrets.ADMIN_LOGIN_PASSWORD)'
`$env:DEFAULT_CONTRACTOR_EMAIL='roadhazard.contractor@gmail.com'
`$env:AUTO_REPAIR_EMAIL_ENABLED='true'
`$env:SMTP_HOST='smtp.gmail.com'
`$env:SMTP_PORT='587'
`$env:SMTP_USE_TLS='true'
`$env:SMTP_USERNAME='roadhazard.sender@gmail.com'
`$env:SMTP_PASSWORD='$($Secrets.SMTP_PASSWORD)'
`$env:SMTP_FROM='roadhazard.sender@gmail.com'
`$env:REPORTER_UPDATE_EMAIL_ENABLED='true'
`$env:REPORTER_UPDATE_SMS_ENABLED='false'
`$env:TWILIO_ACCOUNT_SID=''
`$env:TWILIO_AUTH_TOKEN=''
`$env:TWILIO_FROM_NUMBER=''
`$env:PUBLIC_BASE_URL='$PublicBaseUrl'
& '$PythonExe' app.py
"@

$FrontendViteApiUrl = if ($Mode -eq 'lan') { $ApiUrl } else { '' }
$frontendCmd = @"
Set-Location '$FrontendDir'
`$env:VITE_API_URL='$FrontendViteApiUrl'
`$env:VITE_USE_HTTPS='$([string]($Mode -eq 'lan')).ToLower()'
npm run dev -- --host --port $FrontendPort
"@

Start-Process powershell -ArgumentList @('-NoExit', '-Command', $backendCmd) -WorkingDirectory $ProjectRoot
Start-Process powershell -ArgumentList @('-NoExit', '-Command', $frontendCmd) -WorkingDirectory $ProjectRoot

Write-Host "Started backend + frontend in separate PowerShell windows." -ForegroundColor Green
Write-Host "Mode:        $Mode" -ForegroundColor Cyan
Write-Host "Backend API: ${ApiScheme}://$ApiHost`:5000/api/health" -ForegroundColor Cyan
Write-Host "Frontend:    $FrontendUrl" -ForegroundColor Cyan
Write-Host "Partner URL base: $PublicBaseUrl" -ForegroundColor Cyan
if ($Mode -eq 'lan') {
    Write-Host "LAN Frontend (other devices): https://$LanIp`:$FrontendPort" -ForegroundColor Cyan
    Write-Host "Partner portal (phone-ready): https://$LanIp`:5000/api/repair/partner/<token>" -ForegroundColor Cyan
}
Write-Host "If port $FrontendPort is busy, rerun with: .\start_all.ps1 -FrontendPort 5176" -ForegroundColor Yellow
Write-Host "For phone/LAN access (auto IP): .\start_all.ps1 -Mode lan" -ForegroundColor Yellow
Write-Host "For manual LAN IP override: .\start_all.ps1 -Mode lan -LanIp <your-current-ip>" -ForegroundColor Yellow
