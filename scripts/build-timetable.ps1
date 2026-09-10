<#
  Builds data/timetable.json from the markdown tables in data/source/.

  To refresh times: replace the four data/source/*.md tables with fresh ones
  from bustimes.org (same "| Stop | HH:MM | ... |" shape, stop names matching
  between the outbound and inbound files) and re-run:

      powershell -ExecutionPolicy Bypass -File scripts/build-timetable.ps1
#>
$ErrorActionPreference = 'Stop'
$root   = Split-Path $PSScriptRoot -Parent
$srcDir = Join-Path $root 'data\source'
$outFile = Join-Path $root 'data\timetable.json'

function Get-Slug([string]$s) {
  (($s.ToLower() -replace '[^a-z0-9]+', '-').Trim('-'))
}

function Read-Table([string]$name) {
  $path = Join-Path $srcDir $name
  $rows = @()
  foreach ($line in (Get-Content $path)) {
    if ($line -notmatch '^\s*\|') { continue }
    $inner = $line.Trim() -replace '^\|', '' -replace '\|\s*$', ''
    $cells = $inner -split '\|' | ForEach-Object { $_.Trim() }
    if (($cells -join '') -match '^[-:\s]*$') { continue }   # |---|---| separator
    $rows += , $cells
  }
  [pscustomobject]@{ Header = $rows[0]; Body = $rows[1..($rows.Count - 1)] }
}

# One direction of one day type -> ordered stops + a journey per column.
function Build-Leg($table, [string]$prefix) {
  $ncol = $table.Header.Count - 1
  $order = New-Object System.Collections.Generic.List[string]
  $names = @{}
  $grid  = @{}                       # id -> string[ncol] (may hold $null)

  foreach ($r in $table.Body) {
    $id = Get-Slug $r[0]
    if (-not $grid.ContainsKey($id)) {
      $order.Add($id); $names[$id] = $r[0]
      $grid[$id] = New-Object 'string[]' $ncol
    }
    for ($c = 0; $c -lt $ncol; $c++) {
      $v = if (($c + 1) -lt $r.Count) { $r[$c + 1] } else { '' }
      if ($v -match '^\d{1,2}:\d{2}$' -and $null -eq $grid[$id][$c]) { $grid[$id][$c] = $v }
    }
  }

  $journeys = @()
  for ($c = 0; $c -lt $ncol; $c++) {
    $times = [ordered]@{}
    foreach ($id in $order) { if ($grid[$id][$c]) { $times[$id] = $grid[$id][$c] } }
    $journeys += [pscustomobject]@{ id = ('{0}-{1:d2}' -f $prefix, ($c + 1)); times = $times }
  }
  [pscustomobject]@{ Order = $order; Names = $names; Journeys = $journeys }
}

function New-Direction([string]$id, [string]$name, $mf, $sat, $extraMfJourneys) {
  $order = New-Object System.Collections.Generic.List[string]
  foreach ($x in $mf.Order)  { if (-not $order.Contains($x)) { $order.Add($x) } }
  foreach ($x in $sat.Order) { if (-not $order.Contains($x)) { $order.Add($x) } }

  $stops = foreach ($sid in $order) {
    $nm = if ($mf.Names[$sid]) { $mf.Names[$sid] } else { $sat.Names[$sid] }
    [pscustomobject]@{ id = $sid; name = $nm }
  }

  $mfJourneys = @()
  if ($extraMfJourneys) { $mfJourneys += $extraMfJourneys }
  $mfJourneys += $mf.Journeys

  [pscustomobject]@{
    id    = $id
    name  = $name
    stops = $stops
    services = @(
      [pscustomobject]@{ daysOfWeek = @('Mon','Tue','Wed','Thu','Fri'); label = 'Mondays to Fridays'; journeys = $mfJourneys }
      [pscustomobject]@{ daysOfWeek = @('Sat');                          label = 'Saturdays';          journeys = $sat.Journeys }
    )
  }
}

$mfOut  = Build-Leg (Read-Table 'mf-outbound.md')  'o-mf'
$mfIn   = Build-Leg (Read-Table 'mf-inbound.md')   'i-mf'
$satOut = Build-Leg (Read-Table 'sat-outbound.md') 'o-sa'
$satIn  = Build-Leg (Read-Table 'sat-inbound.md')  'i-sa'

# Early Mon-Fri short working: starts at Kibworth Beauchamp 05:45, runs to Market Hall.
$early = [pscustomobject]@{
  id = 'o-mf-early'
  times = [ordered]@{
    'kibworth-beauchamp-the-square'         = '05:45'
    'kibworth-harcourt-brookfield-way'      = '05:46'
    'market-harborough-gallow-field-road'   = '05:53'
    'market-harborough-owen-way'            = '05:54'
    'market-harborough-woodward-drive'      = '05:55'
    'market-harborough-st-lukes-hospital'   = '05:59'
    'market-harborough-police-station'      = '06:00'
    'market-harborough-bowden-lane'         = '06:03'
    'market-harborough-the-square'          = '06:04'
    'market-harborough-market-hall'         = '06:05'
  }
}

$doc = [pscustomobject]@{
  meta = [pscustomobject]@{
    generatedAt = (Get-Date -Format 'yyyy-MM-dd')
    source      = 'bustimes.org (Arriva Midlands X3)'
    sourceUrl   = 'https://bustimes.org/services/x3-leicester-to-market-harborough'
    validFrom   = '2026-09-03'
    note        = 'All stops, Monday to Saturday. Sunday not added yet.'
  }
  routes = @(
    [pscustomobject]@{
      id = 'x3'; code = 'X3'; operator = 'Arriva Midlands'
      name = 'Leicester and Market Harborough'
      directions = @(
        (New-Direction 'x3-to-harborough' 'To Market Harborough' $mfOut $satOut $early)
        (New-Direction 'x3-to-leicester'  'To Leicester'         $mfIn  $satIn  $null)
      )
    }
  )
}

$json = $doc | ConvertTo-Json -Depth 20
# Minify: JSON ignores inter-token whitespace and no string literal here spans lines.
$json = (($json -split "`r?`n") | ForEach-Object { $_.Trim() }) -join ''
[System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $outFile"
Write-Host ("  To Market Harborough: {0} stops, {1} + {2} journeys" -f $doc.routes[0].directions[0].stops.Count, $doc.routes[0].directions[0].services[0].journeys.Count, $doc.routes[0].directions[0].services[1].journeys.Count)
Write-Host ("  To Leicester:         {0} stops, {1} + {2} journeys" -f $doc.routes[0].directions[1].stops.Count, $doc.routes[0].directions[1].services[0].journeys.Count, $doc.routes[0].directions[1].services[1].journeys.Count)
