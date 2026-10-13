# Weekly Revit Families Library sync - run by Windows Task Scheduler (no Claude needed).
#
#   1. Scans the X: drive library folder for new / changed / moved families.
#   2. If something is waiting and Revit is open, reads the families out of Revit, writes them into
#      the library data and pushes to GitHub (node sync.js run).
#   3. Shows a Windows notification and saves the details to sync\weekly_check.txt.
#
# Publishing to the claude.ai page is the one step that needs Claude: when something was added this
# script writes sync\needs_publish.flag, and you just say "publish the library sync".
param([switch]$Test)

$ErrorActionPreference = 'Continue'   # node writes errors to stderr; PowerShell 5.1 would otherwise treat that as a crash
$root = Split-Path -Parent $PSScriptRoot
$report = Join-Path $PSScriptRoot 'weekly_check.txt'
$flag = Join-Path $PSScriptRoot 'needs_publish.flag'
$maxAuto = 25   # more than this many pending files: ask for a human look instead of running unattended

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

function Save-Report([string]$body) {
    Set-Content -Path $report -Value ("Checked " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + "`r`n`r`n" + $body) -Encoding utf8
}

function Test-Revit {
    # /status/ is 503 when Revit has no project open, but code still runs, so probe with a trivial script
    $body = '{"code":"print(1)","description":"Library sync: connection check"}'
    for ($try = 1; $try -le 3; $try++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:48884/revit_mcp/execute_code/' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
            if ($r.Content -match '"status":\s*"success"') { return $true }
        } catch { }
        Start-Sleep -Seconds 5
    }
    return $false
}

try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $syncJs = Join-Path $PSScriptRoot 'sync.js'

    if ($Test) {
        Save-Report 'Test run - notification only.'
        Show-Notice 'Revit Families Library' 'Test notification - the weekly sync is set up.'
        return
    }

    $scan = (& $node $syncJs scan 2>&1 | Out-String).Trim()
    if ($scan -notmatch 'Pending work: (\d+) new, (\d+) changed, (\d+) moved') {
        Save-Report $scan
        if ($scan -match 'ERROR') { Show-Notice 'Revit Families Library: check failed' (($scan -split "`n" | Select-String 'ERROR' | Select-Object -First 1).ToString()) }
        return   # up to date: stay quiet
    }
    $new = [int]$Matches[1]; $changed = [int]$Matches[2]; $moved = [int]$Matches[3]
    $total = $new + $changed + $moved
    $summary = "$new new, $changed changed, $moved moved"

    if ($total -gt $maxAuto) {
        Save-Report ("Too many pending to run unattended ($summary).`r`n`r`n" + $scan)
        Show-Notice 'Revit Families Library: updates waiting' "$summary - that is a lot, so it was not run automatically. Open Revit and ask Claude to 'sync the library'."
        return
    }

    # moved-only needs no Revit; new / changed families do
    if (($new + $changed) -gt 0 -and -not (Test-Revit)) {
        Save-Report ("Revit is not reachable, so nothing was added ($summary).`r`n`r`n" + $scan)
        Show-Notice 'Revit Families Library: updates waiting' "$summary. Revit was not reachable. Open Revit and ask Claude to 'sync the library'."
        return
    }

    $run = (& $node $syncJs run 2>&1 | Out-String).Trim()
    Save-Report ("Automatic sync ($summary)`r`n`r`n" + $run)

    $sumFile = Join-Path $PSScriptRoot 'work\summary.json'
    if ((Test-Path $sumFile) -and ((Get-Item $sumFile).LastWriteTime -gt (Get-Date).AddMinutes(-30))) {
        $s = Get-Content $sumFile -Raw | ConvertFrom-Json
        $done = [int]$s.added + [int]$s.updated + [int]$s.moved
        if ($done -gt 0) {
            Set-Content -Path $flag -Value ("Library data updated " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ": $($s.added) added, $($s.updated) updated, $($s.moved) moved. Not yet published to the artifact.") -Encoding utf8
            $where = if ($run -match 'Pushed to GitHub') { 'saved to GitHub' } else { 'saved on this PC but the GitHub push failed' }
            $msg = "$($s.added) added, $($s.updated) updated, $($s.moved) moved - $where."
            if ([int]$s.failed -gt 0) { $msg += " $($s.failed) could not be read (see sync\weekly_check.txt)." }
            Show-Notice 'Revit Families Library: updated' ($msg + " Ask Claude to 'publish the library sync' to put it on the page.")
            return
        }
    }
    Show-Notice 'Revit Families Library: sync problem' "The automatic sync did not add anything ($summary). See sync\weekly_check.txt."
}
catch {
    Save-Report ("ERROR: " + $_.Exception.Message)
    Show-Notice 'Revit Families Library: check failed' $_.Exception.Message
}
