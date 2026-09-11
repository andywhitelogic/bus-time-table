<#
  One-off fix: the bustimes.org read for X7's Oadby/Stoneygate/Knighton Road/
  Clarendon Park stretch (Northampton-to-Leicester direction) came back with
  every one of those stops showing the identical time in every journey column -
  not physically possible over ~2 miles of road, and not what the reverse
  direction's data (or Stagecoach's own printed timetable) shows for the same
  stretch.

  Fix: re-space those stops proportionally between the two neighbouring stops
  whose times ARE trustworthy (Kibworth Harcourt Lodge Close before, Leicester
  Station Street after), using the relative spacing the Leicester-to-Northampton
  table shows for the same physical stops in reverse. This is a disclosed
  interpolation to replace known-bad data, not a source of new precision -
  see README.
#>
$ErrorActionPreference = 'Stop'
$srcDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\source'

# Fraction of the Lodge-Close -> Station-Street gap at which each stop sits,
# derived from the inbound direction's real inter-stop spacing (mirrored).
$fractions = [ordered]@{
  'Oadby Owl'                    = 11/23
  'Oadby Lidl'                   = 12/23
  'Stoneygate Shirley Road'      = 16/23
  'Leicester Knighton Road'      = 17/23
  'Clarendon Park St Johns Road' = 19/23
  'Clarendon Park St James Road' = 20/23
}

function ToMin([string]$t) { $p = $t -split ':'; [int]$p[0] * 60 + [int]$p[1] }
function ToHHMM([int]$m) {
  $h = ([math]::Floor($m / 60) % 24).ToString().PadLeft(2, '0')
  $mm = ($m % 60).ToString().PadLeft(2, '0')
  "$h`:$mm"
}

function Cells([string]$line) {
  $inner = $line.Trim() -replace '^\|', '' -replace '\|\s*$', ''
  , ($inner -split '\|' | ForEach-Object { $_.Trim() })
}

function Fix-File([string]$path) {
  $lines = Get-Content $path
  $ncol = (Cells $lines[0]).Count - 1   # header: Stop + ncol time columns

  $rowOf = @{}
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\|\s*([^|]+?)\s*\|') { $rowOf[$Matches[1]] = $i }
  }
  $before = Cells $lines[$rowOf['Kibworth Harcourt Lodge Close']]  # [0]=name, [1..ncol]=times
  $after  = Cells $lines[$rowOf['Leicester Station Street']]

  foreach ($stop in $fractions.Keys) {
    $times = New-Object System.Collections.Generic.List[string]
    for ($c = 1; $c -le $ncol; $c++) {
      $b = $before[$c]; $a = $after[$c]
      if ($b -match '^\d{1,2}:\d{2}$' -and $a -match '^\d{1,2}:\d{2}$') {
        $mins = ToMin $b
        $gap = (ToMin $a) - $mins
        $times.Add((ToHHMM ($mins + [math]::Round($gap * $fractions[$stop]))))
      } else {
        $times.Add('')
      }
    }
    $lines[$rowOf[$stop]] = '| ' + $stop + ' | ' + ($times -join ' | ') + ' |'
  }
  Set-Content -Path $path -Value $lines -Encoding UTF8
  Write-Host "Fixed $path ($ncol columns)"
}

Fix-File (Join-Path $srcDir 'x7-mf-outbound.md')
Fix-File (Join-Path $srcDir 'x7-sat-outbound.md')
