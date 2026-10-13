$project = $PSScriptRoot
$start = Join-Path $project 'start_all.ps1'
$stop = Join-Path $project 'stop_all.ps1'

if (!(Test-Path $start) -or !(Test-Path $stop)) {
    Write-Host "Missing start_all.ps1 or stop_all.ps1 in $project" -ForegroundColor Red
    exit 1
}

$profiles = @(
    (Join-Path $HOME 'Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1'),
    (Join-Path $HOME 'Documents\PowerShell\Microsoft.PowerShell_profile.ps1')
) | Sort-Object -Unique

$functionStart = "function start_all { & '$start' @args }"
$functionStop = "function stop_all { & '$stop' @args }"

foreach ($profilePath in $profiles) {
    $profileDir = Split-Path $profilePath -Parent
    if (!(Test-Path $profileDir)) {
        New-Item -Path $profileDir -ItemType Directory -Force | Out-Null
    }
    if (!(Test-Path $profilePath)) {
        New-Item -Path $profilePath -ItemType File -Force | Out-Null
    }

    $content = Get-Content $profilePath -ErrorAction SilentlyContinue
    if ($content -notcontains $functionStart) { Add-Content -Path $profilePath -Value $functionStart }
    if ($content -notcontains $functionStop) { Add-Content -Path $profilePath -Value $functionStop }
}

function global:start_all { & $start @args }
function global:stop_all { & $stop @args }

Write-Host "Short commands configured." -ForegroundColor Green
Write-Host "Now you can use: start_all and stop_all" -ForegroundColor Cyan
Write-Host "Updated profiles:" -ForegroundColor DarkGray
$profiles | ForEach-Object { Write-Host " - $_" -ForegroundColor DarkGray }
