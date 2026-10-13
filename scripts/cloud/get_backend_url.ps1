# Get Cloud Run backend URL and show setup instructions
$projectId = "roadhazard-fyp"
$serviceId = "roadhazard-api"
$region = "asia-southeast1"

Write-Host "`n=== Getting Cloud Run Backend URL ===" -ForegroundColor Cyan

# Get the full Cloud Run service URL
$backendUrl = gcloud run services describe $serviceId --region $region --format="value(status.url)" 2>$null

if ($backendUrl) {
    Write-Host "✓ Cloud Run URL: $backendUrl" -ForegroundColor Green
    Write-Host "✓ API Endpoint: $backendUrl/api" -ForegroundColor Green
    
    # Show path to update in App.jsx
    $appJsxPath = ".\frontend\src\App.jsx"
    Write-Host "`nTo update frontend, change this line in $appJsxPath :" -ForegroundColor Yellow
    Write-Host "    return '$backendUrl/api';" -ForegroundColor Cyan
    
} else {
    Write-Host "✗ Could not retrieve Cloud Run URL" -ForegroundColor Red
    Write-Host "Try checking manually at: https://console.cloud.google.com/run" -ForegroundColor Yellow
}

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Copy the URL above" -ForegroundColor White
Write-Host "2. Update frontend\src\App.jsx line 22 with the URL" -ForegroundColor White
Write-Host "3. Run: npm --prefix frontend run build" -ForegroundColor White
Write-Host "4. Run: firebase deploy --only hosting --project $projectId" -ForegroundColor White
