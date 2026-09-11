#!/usr/bin/env node
/*
  Fetches live vehicle positions for X3 and X7 from the DfT Bus Open Data
  Service (BODS) and estimates a delay (in minutes) for whichever journeys
  currently have a tracked bus, writing data/live-delays.json for app.js to
  read alongside the static timetable.

  IMPORTANT LIMITATION: BODS's live feed (both SIRI-VM and GTFS-RT) only
  gives a vehicle's GPS position plus its scheduled origin/destination times
  - no ready-made "delay" field, confirmed by inspecting real responses.
  So the delay here is an ESTIMATE: for a tracked vehicle, we take how far
  (in a straight line) it still has to travel to its destination as a
  fraction of the straight-line origin-to-destination distance, use that to
  guess how much of the scheduled journey time "should" have elapsed by now,
  and compare that to how much actually has. It is a straight-line
  approximation (no real route geometry), and both X3 and X7 loop through
  villages rather than running direct, so treat it as a rough "running late/
  early" indicator, not a precise ETA. It's also applied per journey, not
  per stop, and (for X7 specifically, which changes vehicle/driver at
  Market Harborough) a delay measured on one leg is carried onto the whole
  journey as a best guess even where the other leg is a different vehicle.

  Requires BODS_API_KEY in the environment. No npm dependencies - SIRI-VM is
  simple, flat-ish XML and is parsed here with plain regex rather than
  pulling in an XML library for a handful of fields.
*/

import { readFileSync, writeFileSync } from "node:fs";

const API_KEY = process.env.BODS_API_KEY;
if (!API_KEY) {
  console.error("Missing BODS_API_KEY environment variable.");
  process.exit(1);
}

const TIMETABLE_PATH = "data/timetable.json";
const OUT_PATH = "data/live-delays.json";

// Which BODS feed to poll for each of our routes.
const FEEDS = [
  { routeId: "x3", operatorRef: "AMID", lineRef: "X3" },
  { routeId: "x7", operatorRef: "SCNH", lineRef: "X7" },
];

// Real-world coordinates for the handful of hub stops that show up as a live
// vehicle's OriginName/DestinationName. X7 splits its Northampton<->Leicester
// working at Market Harborough (see the timetable's driver-change note), so
// every live segment we see is between two of these, even though our own
// timetable.json models each route end-to-end.
const KNOWN_STOPS = [
  { id: "leicester-haymarket-bus-station", lat: 52.63793, lon: -1.13139, match: ["haymarket bus station"] },
  { id: "market-harborough-market-hall", lat: 52.4783, lon: -0.9214, match: ["market hall"] },
  { id: "market-harborough-the-square", lat: 52.4779, lon: -0.9203, match: ["the square"] },
  { id: "northampton-bus-interchange", lat: 52.2387, lon: -0.8985, match: ["northampton bus interchange"] },
];

function resolveStop(name) {
  const norm = name.toLowerCase().replace(/_/g, " ").trim();
  for (const s of KNOWN_STOPS) {
    if (s.match.some((m) => m === norm || m.startsWith(norm) || norm.startsWith(m))) return s;
  }
  return null; // an endpoint we don't recognise - skip rather than guess
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function blocks(xml, name) {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function londonParts(isoUtc) {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const timetable = JSON.parse(readFileSync(TIMETABLE_PATH, "utf8"));
const delays = {};
let vehiclesSeen = 0;
let matched = 0;

for (const feed of FEEDS) {
  const route = timetable.routes.find((r) => r.id === feed.routeId);
  if (!route) continue;

  const url = `https://data.bus-data.dft.gov.uk/api/v1/datafeed/?operatorRef=${feed.operatorRef}&lineRef=${feed.lineRef}&api_key=${API_KEY}`;
  let xml;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`${feed.routeId}: HTTP ${res.status}`);
      continue;
    }
    xml = await res.text();
  } catch (err) {
    console.error(`${feed.routeId}: fetch failed - ${err.message}`);
    continue;
  }

  for (const va of blocks(xml, "VehicleActivity")) {
    vehiclesSeen++;
    const recordedAt = tag(va, "RecordedAtTime");
    const [mvj] = blocks(va, "MonitoredVehicleJourney");
    if (!recordedAt || !mvj) continue;

    const originName = tag(mvj, "OriginName");
    const destName = tag(mvj, "DestinationName");
    const aimedDep = tag(mvj, "OriginAimedDepartureTime");
    const [vloc] = blocks(mvj, "VehicleLocation");
    if (!originName || !destName || !aimedDep || !vloc) continue;

    const origin = resolveStop(originName);
    const dest = resolveStop(destName);
    if (!origin || !dest || origin.id === dest.id) continue;

    const lat = Number(tag(vloc, "Latitude"));
    const lon = Number(tag(vloc, "Longitude"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const { weekday } = londonParts(recordedAt);
    const aimedDepMin = londonParts(aimedDep).minutes;

    // Find which of our journeys (in whichever direction has both stops, in
    // order) this vehicle is running, by matching its aimed departure time
    // from the origin stop against our own schedule for that stop.
    let best = null;
    for (const dir of route.directions) {
      const ids = dir.stops.map((s) => s.id);
      const oi = ids.indexOf(origin.id);
      const di = ids.indexOf(dest.id);
      if (oi === -1 || di === -1 || oi >= di) continue;
      for (const svc of dir.services) {
        if (!svc.daysOfWeek.includes(weekday)) continue;
        for (const j of svc.journeys) {
          const ot = j.times[origin.id];
          const dt = j.times[dest.id];
          if (!ot || !dt) continue;
          const diff = Math.abs(toMin(ot) - aimedDepMin);
          if (diff <= 5 && (!best || diff < best.diff)) {
            best = { journeyId: j.id, diff, originMin: toMin(ot), destMin: toMin(dt) };
          }
        }
      }
    }
    if (!best) continue;

    const totalKm = haversineKm(origin, dest);
    const remainingKm = haversineKm({ lat, lon }, dest);
    const fractionRemaining = totalKm > 0 ? Math.min(1, Math.max(0, remainingKm / totalKm)) : 0;

    const scheduledDuration = best.destMin - best.originMin;
    const expectedNowMin = best.originMin + scheduledDuration * (1 - fractionRemaining);
    const actualNowMin = londonParts(recordedAt).minutes;
    const delayMin = Math.round(actualNowMin - expectedNowMin);

    // A wildly large figure means a bad match or a GPS glitch, not a real
    // 90-minutes-late bus - drop it rather than show nonsense.
    if (Math.abs(delayMin) > 45) continue;

    const existing = delays[best.journeyId];
    if (!existing || recordedAt > existing.asOf) {
      delays[best.journeyId] = { delayMin, asOf: recordedAt };
      matched++;
    }
  }
}

writeFileSync(
  OUT_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), delays })
);
console.log(`${vehiclesSeen} vehicle(s) seen, ${matched} matched to a journey. Wrote ${OUT_PATH}.`);
