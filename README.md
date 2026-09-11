# Bus Times

A tiny static web app that shows the next departures for a bus route from a chosen
stop, plus the full timetable for the day. Built for phones first.

Two routes are set up, every stop, Monday to Saturday, from
[bustimes.org](https://bustimes.org/) (timetables valid from September 2026):

- **X3** (Arriva Midlands) — Leicester and Market Harborough
- **X7** (Stagecoach Midlands) — Northampton, Market Harborough and Leicester

Sunday is not in the data yet for either. Adding a third route later is just another
set of `data/source/<prefix>-*.md` files plus one line in
`scripts/build-timetable.ps1` — the app's route picker (**Bus**) and everything else
adapts automatically.

Pick a **Bus**, a **From** stop and a **To** stop (swap them with the ⇄ button) and
the departures list shows the departure and arrival time for every journey that runs
that way, with a live countdown for today. Tapping a journey expands it to show the
stops in between.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup |
| `styles.css` | Styling (light + dark) |
| `app.js` | Loads the JSON, renders next departures and the timetable |
| `data/timetable.json` | Generated timetable data the app reads (do not edit by hand) |
| `data/source/x3-*.md`, `data/source/x7-*.md` | The bustimes.org tables each route's JSON is built from |
| `scripts/build-timetable.ps1` | Turns `data/source/*.md` into `data/timetable.json` |

The app itself has no build step, no dependencies and no framework. The build script
is only for regenerating the timetable data.

## Running locally

The app fetches `data/timetable.json`, so it needs to be served over HTTP (opening
`index.html` from disk will not work in most browsers).

```bash
# any one of these, from the project folder:
python -m http.server 8000
npx serve .
```

Then open http://localhost:8000.

## Hosting

Upload every file (keeping the `data/` folder) to any static/plain-HTML web host via
cPanel, FTP, Netlify drop, GitHub Pages, etc. There is nothing server-side to run.

## Updating the timetable (current method)

Each route has four source tables named `<prefix>-<day>-<direction>.md`, e.g.
`x3-mf-outbound.md`, `x7-sat-inbound.md` (`mf` = Monday-Friday, `sat` = Saturday).

1. Open the route's page on [bustimes.org](https://bustimes.org/), pick a date for
   the day type you want (a weekday, then a Saturday).
2. Copy each direction's grid into the matching `data/source/<prefix>-*.md` file,
   keeping the `| Stop | HH:MM | HH:MM | ... |` shape. Use the **same stop name**
   in both the outbound and inbound files for a stop served both ways, so it stays
   a single stop in the app.
3. Regenerate the data:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/build-timetable.ps1
   ```

To add a new route, add its four `data/source/<prefix>-*.md` files and one more
`Build-Route` call (copy the `$x7 = Build-Route ...` line) near the bottom of
`scripts/build-timetable.ps1`.

X3's one early Mon-Fri short working (Kibworth Beauchamp 05:45 to Market Hall) is
added by the script itself, since it doesn't start from either table's first stop;
see the `$x3Early` block if it ever changes.

`scripts/fix-x7-outbound-gap.ps1` is a one-off patch, already applied: the
bustimes.org read for X7's Oadby/Stoneygate/Knighton Road/Clarendon Park stretch
(Northampton-to-Leicester direction only) came back with every one of those stops
showing an identical time in every journey — not physically possible over that
distance. It re-spaces those stops proportionally between the two neighbouring
stops that read correctly, using the reverse direction's real spacing for the same
stops. Re-run it (before rebuilding) if a future refresh of
`x7-mf-outbound.md` / `x7-sat-outbound.md` reintroduces the same fault.

### Data shape (what the script emits)

`data/timetable.json`:

```jsonc
{
  "meta": {
    "sourceUrl": "https://www.arrivabus.co.uk/...",  // where the times were copied from
    "note": "Shown in the app footer"
  },
  "routes": [
    {
      "id": "x3",                 // stable slug, used in saved preferences
      "code": "X3",               // shown to the user
      "operator": "Arriva Midlands",
      "name": "Leicester and Market Harborough",
      "directions": [
        {
          "id": "x3-outbound",
          "name": "To Market Harborough",
          "stops": [
            { "id": "haymarket", "name": "Leicester, Haymarket Bus Station" }
            // ...in timetable order
          ],
          "services": [
            {
              "daysOfWeek": ["Mon", "Tue", "Wed", "Thu", "Fri"],
              "label": "Mondays to Fridays",
              "journeys": [
                {
                  "id": "o-mf-02",
                  "times": {
                    "haymarket": "06:00",   // "HH:MM" 24-hour
                    "kibworth": null         // null = this journey skips / starts after this stop
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Rules:

- Stop `id`s are your own choice; reuse the same `id` across directions for the same
  physical stop so a saved "your stop" preference keeps working.
- Every journey lists every stop `id` for its direction; use `null` where the bus does
  not stop.
- One `service` per distinct day pattern (weekday / Saturday / Sunday / school days).
  A day with no matching service shows "No service".
- The app has no direction picker. Given a **From** and **To** stop, it searches a
  route's directions for one where both stops appear in that order and uses it —
  so a direction only needs its own stop list; the app works out which way to go.

## Planned: switch to Bus Open Data Service (BODS)

The JSON shape above deliberately mirrors TransXChange (BODS's format): routes →
services (days of operation) → journeys → per-stop times. The intended next step:

1. Get a free API key from https://data.bus-data.dft.gov.uk/.
2. Add `scripts/build-from-bods.mjs` that downloads the X3 (and X7) TransXChange
   dataset and emits this exact `data/timetable.json`.
3. Run it on a schedule (GitHub Action / cron) so the site stays current with no
   manual transcription.

The app itself should not need to change.
