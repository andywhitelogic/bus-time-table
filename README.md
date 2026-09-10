# Bus Times

A tiny static web app that shows the next departures for a bus route from a chosen
stop, plus the full timetable for the day. Built for phones first.

Currently set up for **Arriva Midlands X3** (Leicester and Market Harborough), key
stops only, Monday to Saturday. Times were transcribed from
[bustimes.org](https://bustimes.org/services/x3-leicester-to-market-harborough)
(timetable valid from 3 September 2026). Sunday is not in the data yet.

Stagecoach **X7** can be added later by dropping another route entry into
`data/timetable.json`. The app shows a route picker automatically once there is more
than one route.

Tapping a departure expands it to show the time that bus reaches every stop after
yours, with the destination arrival highlighted.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup |
| `styles.css` | Styling (light + dark) |
| `app.js` | Loads the JSON, renders next departures and the timetable |
| `data/timetable.json` | The timetable data — **this is the only file you edit to update times** |

No build step, no dependencies, no framework.

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

## Updating the timetable (current method: hand-transcription)

Edit `data/timetable.json`.

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
          "id": "x3-to-harborough",
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

## Planned: switch to Bus Open Data Service (BODS)

The JSON shape above deliberately mirrors TransXChange (BODS's format): routes →
services (days of operation) → journeys → per-stop times. The intended next step:

1. Get a free API key from https://data.bus-data.dft.gov.uk/.
2. Add `scripts/build-from-bods.mjs` that downloads the X3 (and X7) TransXChange
   dataset and emits this exact `data/timetable.json`.
3. Run it on a schedule (GitHub Action / cron) so the site stays current with no
   manual transcription.

The app itself should not need to change.
