# Install PyTorch with GPU (CUDA 11.8) Support
# Run this in PowerShell from the project directory

Write-Host "Installing PyTorch with GPU support..." -ForegroundColor Green

# Activate virtual environment first
& ".\venv\Scripts\Activate.ps1"

# Uninstall old CPU PyTorch
Write-Host "Removing old PyTorch CPU version..." -ForegroundColor Yellow
python -m pip uninstall torch torchvision torchaudio -y

# Install GPU version
Write-Host "Installing PyTorch with CUDA 11.8 support..." -ForegroundColor Yellow
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Verify installation
Write-Host "`nVerifying GPU support..." -ForegroundColor Cyan
python -c "import torch; print(f'PyTorch Version: {torch.__version__}'); print(f'CUDA Available: {torch.cuda.is_available()}'); print(f'GPU Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"

Write-Host "`nDone! GPU support installed." -ForegroundColor Green
Write-Host "You can now run: python train_multi_class.py" -ForegroundColor Green
