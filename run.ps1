# Windows PowerShell launcher.  Usage (in PowerShell):  .\run.ps1
# From cmd.exe instead, run:  python run.py
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
python run.py
