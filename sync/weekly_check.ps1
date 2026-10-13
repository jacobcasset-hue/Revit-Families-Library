# Weekly Revit Families Library check - run by Windows Task Scheduler (no Claude needed).
# Scans the X: drive library folder, saves the result to sync\weekly_check.txt and shows a
# Windows notification when something is new / changed / moved (or the check could not run).
param([switch]$Test)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$report = Join-Path $PSScriptRoot 'weekly_check.txt'

function Show-Notice([string]$title, [string]$text) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(20000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Seconds 21
    $n.Dispose()
}

try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $out = (& $node (Join-Path $PSScriptRoot 'sync.js') scan 2>&1 | Out-String).Trim()
    Set-Content -Path $report -Value ("Checked " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + "`r`n`r`n" + $out) -Encoding utf8

    if ($Test) {
        Show-Notice 'Revit Families Library' 'Test notification - the weekly check is set up.'
    }
    elseif ($out -match 'Pending work: (\d+) new, (\d+) changed, (\d+) moved') {
        $text = "$($Matches[1]) new, $($Matches[2]) changed, $($Matches[3]) moved. Open Revit and ask Claude to 'sync the library'. Details: sync\weekly_check.txt"
        Show-Notice 'Revit Families Library: updates waiting' $text
    }
    elseif ($out -match 'ERROR') {
        Show-Notice 'Revit Families Library: check failed' ($out -split "`n" | Select-String 'ERROR' | Select-Object -First 1).ToString()
    }
}
catch {
    Set-Content -Path $report -Value ("Checked " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + "`r`n`r`nERROR: " + $_.Exception.Message) -Encoding utf8
    Show-Notice 'Revit Families Library: check failed' $_.Exception.Message
}
