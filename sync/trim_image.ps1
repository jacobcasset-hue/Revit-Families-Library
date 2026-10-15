# Trims the white margin off a PNG, adds a little padding, scales to fit MaxDim and saves it as PNG.
# Used for annotation / tag families, whose exported sheet view is mostly empty paper.
param([string]$InFile, [string]$OutFile, [int]$MaxDim = 560, [double]$Pad = 0.12)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile($InFile)
$w = $src.Width; $h = $src.Height
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$src.UnlockBits($data)
$minX = $w; $minY = $h; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
        $i = $row + $x * 4
        # non-white: any channel below 235 (and not fully transparent)
        if ($bytes[$i + 3] -gt 10 -and ($bytes[$i] -lt 235 -or $bytes[$i + 1] -lt 235 -or $bytes[$i + 2] -lt 235)) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
if ($maxX -lt 0) { $src.Dispose(); Copy-Item $InFile $OutFile -Force; exit 0 }
$cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
$side = [Math]::Max($cw, $ch)
$padPx = [int]($side * $Pad) + 4
$boxW = $cw + 2 * $padPx; $boxH = $ch + 2 * $padPx
$scale = [Math]::Min($MaxDim / $boxW, $MaxDim / $boxH)
if ($scale -gt 6) { $scale = 6 }   # tiny symbols: enlarge, but not without limit
$nw = [Math]::Max(1, [int]($boxW * $scale)); $nh = [Math]::Max(1, [int]($boxH * $scale))
$dst = New-Object System.Drawing.Bitmap($nw, $nh)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$destRect = New-Object System.Drawing.RectangleF([single]($padPx * $scale), [single]($padPx * $scale), [single]($cw * $scale), [single]($ch * $scale))
$srcRect = New-Object System.Drawing.RectangleF([single]$minX, [single]$minY, [single]$cw, [single]$ch)
$g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()
$dst.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
