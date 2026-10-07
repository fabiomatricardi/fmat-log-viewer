# publish.ps1 — daily one-command publish
#   1. encrypts personal_log.db -> data/log.enc (password prompted, never stored)
#   2. commits and pushes to GitHub; GitHub Pages republishes automatically
#
# Usage:  .\scripts\publish.ps1

param(
    [string]$DbPath = (Join-Path $PSScriptRoot "..\personal_log.db"),
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DbPath)) {
    Write-Host "error: database not found: $DbPath" -ForegroundColor Red
    exit 1
}

$secure = Read-Host "Encryption password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $plain) { Write-Host "error: empty password" -ForegroundColor Red; exit 1 }

Push-Location $RepoRoot
try {
    Write-Host "Encrypting database..." -ForegroundColor Cyan
    $plain | python (Join-Path $PSScriptRoot "encrypt.py") $DbPath (Join-Path $RepoRoot "data\log.enc")
    if ($LASTEXITCODE -ne 0) { throw "encryption failed" }

    git add data/log.enc
    if ($LASTEXITCODE -ne 0) { throw "git add failed" }

    $dirty = git status --porcelain
    if ($dirty) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
        git commit -m "daily update $ts"
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
        git push
        if ($LASTEXITCODE -ne 0) {
            Write-Host "push failed - check your GitHub credentials and retry: git push" -ForegroundColor Red
            exit 1
        }
        Write-Host "Published. Pages will refresh in a few minutes." -ForegroundColor Green
        Write-Host "https://fabiomatricardi.github.io/fmat-log-viewer/"
    } else {
        Write-Host "Nothing changed - no commit needed." -ForegroundColor Yellow
    }
} finally {
    $plain = $null
    Pop-Location
}
