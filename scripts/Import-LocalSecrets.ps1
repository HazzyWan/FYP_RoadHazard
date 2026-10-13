# Loads KEY=VALUE pairs from secrets.local.env (project root) into a hashtable.
# Usage: . "$PSScriptRoot\scripts\Import-LocalSecrets.ps1"; $Secrets = Import-LocalSecrets
function Import-LocalSecrets {
    $path = Join-Path (Split-Path $PSScriptRoot -Parent) 'secrets.local.env'
    if (-not (Test-Path $path)) {
        throw "Missing $path. Copy secrets.example.env to secrets.local.env and fill in the values."
    }
    $secrets = @{}
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $secrets[$Matches[1]] = $Matches[2].Trim()
        }
    }
    return $secrets
}
