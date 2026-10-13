param(
    [int[]]$FrontendPorts = @(5173, 5174, 5175, 5176, 5177),
    [int]$BackendPort = 5000
)

$ProjectRoot = $PSScriptRoot
$killed = @()

function Stop-ByPid {
    param([int]$PidToStop, [string]$Reason)

    if ($PidToStop -and $PidToStop -gt 0) {
        try {
            Stop-Process -Id $PidToStop -Force -ErrorAction Stop
            $script:killed += "PID $PidToStop ($Reason)"
        }
        catch {
        }
    }
}

# 1) Stop known project processes by command line signature
$procs = Get-CimInstance Win32_Process | Where-Object {
    ($_.CommandLine -like "*FYP_RoadHazard*webapp*app.py*") -or
    ($_.CommandLine -like "*FYP_RoadHazard*frontend*vite*") -or
    ($_.CommandLine -like "*FYP_RoadHazard*frontend*npm run dev*")
}

foreach ($p in $procs) {
    Stop-ByPid -PidToStop $p.ProcessId -Reason "project command"
}

# 2) Fallback: stop listeners on backend/frontend ports
$ports = @($BackendPort) + $FrontendPorts

foreach ($port in $ports) {
    $lines = netstat -ano -p tcp | Select-String ":$port\s"
    foreach ($line in $lines) {
        $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
        if ($parts.Count -ge 5) {
            $pidValue = 0
            [void][int]::TryParse($parts[-1], [ref]$pidValue)
            if ($pidValue -gt 0) {
                Stop-ByPid -PidToStop $pidValue -Reason "port $port"
            }
        }
    }
}

if ($killed.Count -eq 0) {
    Write-Host "No matching backend/frontend processes found." -ForegroundColor Yellow
    exit 0
}

$killed = $killed | Sort-Object -Unique
Write-Host "Stopped processes:" -ForegroundColor Green
$killed | ForEach-Object { Write-Host " - $_" -ForegroundColor Green }
