# Start Flask with HTTPS
$env:USE_SSL="true"
$env:SSL_CERT="$PSScriptRoot\certs\192.168.0.11+2.pem"
$env:SSL_KEY="$PSScriptRoot\certs\192.168.0.11+2-key.pem"

$detectDir = Join-Path $PSScriptRoot "runs\detect"
$modelCandidates = @()
if (Test-Path $detectDir) {
	$modelCandidates = @(Get-ChildItem -Path $detectDir -Directory -Filter "road_hazards_multi*" |
		ForEach-Object { Join-Path $_.FullName "weights\best.pt" } |
		Where-Object { Test-Path $_ } |
		Sort-Object { (Get-Item $_).LastWriteTime } -Descending)
}

if ($modelCandidates.Count -gt 0) {
	$env:MODEL_PATH = @($modelCandidates)[0]
}

$env:INFER_CONF = "0.25"
$env:INFER_IOU = "0.45"
$env:INFER_CLASS_CONF = '{"pothole":0.40,"alligator_crack":0.24,"longitudinal_crack":0.24,"other":0.30,"crack":0.24}'
$env:INFER_CRACK_SUBTYPE_MIN_CONF = "0.66"
$env:SCENARIO_CONSENSUS_MIN_MARGIN = "0.18"
$env:SCENARIO_CONSENSUS_MIN_SCORE = "0.56"
$env:SCENARIO_ORIGINAL_WEIGHT = "1.10"
$env:AUTO_RETRAIN_ON_FEEDBACK = "true"
$env:AUTO_RETRAIN_MIN_FEEDBACK = "10"
$env:AUTO_RETRAIN_COOLDOWN_MIN = "0"
. "$PSScriptRoot\scripts\Import-LocalSecrets.ps1"
$Secrets = Import-LocalSecrets
$env:ADMIN_LOGIN_EMAIL = $Secrets.ADMIN_LOGIN_EMAIL
$env:ADMIN_LOGIN_PASSWORD = $Secrets.ADMIN_LOGIN_PASSWORD
$env:SMTP_PASSWORD = $Secrets.SMTP_PASSWORD

Set-Location -Path "$PSScriptRoot\webapp"
python app.py
