param([string]$InFile, [string]$OutFile, [int]$MaxDim = 600, [int]$Quality = 75)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($InFile)
$w = $img.Width; $h = $img.Height
$scale = [Math]::Min(1.0, $MaxDim / [Math]::Max($w, $h))
$nw = [Math]::Max(1, [int]($w * $scale))
$nh = [Math]::Max(1, [int]($h * $scale))
$bmp = New-Object System.Drawing.Bitmap($nw, $nh)
$bmp.SetResolution($img.HorizontalResolution, $img.VerticalResolution)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($img, 0, 0, $nw, $nh)
$g.Dispose(); $img.Dispose()
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
$bmp.Save($OutFile, $jpegCodec, $encParams)
$bmp.Dispose()
