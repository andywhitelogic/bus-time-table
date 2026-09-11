"use strict";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS = {
  Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday",
};
const STORE_KEY = "bus-times-choice";

const el = {
  routeSelect: document.getElementById("route-select"),
  routeStatic: document.getElementById("route-static"),
  routeLine: document.getElementById("route-line"),
  fromSelect: document.getElementById("from-select"),
  toSelect: document.getElementById("to-select"),
  swapBtn: document.getElementById("swap-btn"),
  daySelect: document.getElementById("day-select"),
  nextList: document.getElementById("next-list"),
  nextEmpty: document.getElementById("next-empty"),
  nextNone: document.getElementById("next-none"),
  toggleTimetable: document.getElementById("toggle-timetable"),
  timetableWrap: document.getElementById("timetable-wrap"),
  dataNote: document.getElementById("data-note"),
};

const LIVE_MAX_AGE_MS = 20 * 60 * 1000; // ignore live-delays.json older than this

let DATA = null;
let LIVE = null;
let choice = loadChoice();
let expandedKey = null;

init();

async function init() {
  try {
    const res = await fetch("data/timetable.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    el.routeLine.textContent = "Could not load timetable data.";
    console.error(err);
    return;
  }

  loadLiveDelays();
  setInterval(loadLiveDelays, 60000);

  buildDayOptions();
  buildRouteOptions();

  el.routeSelect.addEventListener("change", () => {
    choice.routeId = el.routeSelect.value;
    // Keep From/To as-is where possible: onRouteChange() below only replaces
    // them if the new route doesn't have that stop at all (e.g. a stop the
    // two routes both serve, like Leicester Haymarket, should stay selected).
    expandedKey = null;
    saveChoice();
    onRouteChange();
  });
  el.fromSelect.addEventListener("change", () => {
    choice.fromId = el.fromSelect.value;
    expandedKey = null;
    saveChoice();
    render();
  });
  el.toSelect.addEventListener("change", () => {
    choice.toId = el.toSelect.value;
    expandedKey = null;
    saveChoice();
    render();
  });
  el.swapBtn.addEventListener("click", () => {
    [choice.fromId, choice.toId] = [choice.toId, choice.fromId];
    el.fromSelect.value = choice.fromId;
    el.toSelect.value = choice.toId;
    expandedKey = null;
    saveChoice();
    render();
  });
  el.daySelect.addEventListener("change", () => {
    choice.dayKey = el.daySelect.value;
    expandedKey = null;
    saveChoice();
    render();
  });
  el.toggleTimetable.addEventListener("click", () => {
    const open = el.timetableWrap.hidden;
    el.timetableWrap.hidden = !open;
    el.toggleTimetable.setAttribute("aria-expanded", String(open));
    el.toggleTimetable.textContent = open ? "Hide full timetable" : "Show full timetable";
  });

  onRouteChange();

  if (DATA.meta && DATA.meta.note) el.dataNote.textContent = DATA.meta.note;

  setInterval(render, 30000);
}

/* ---------- option builders ---------- */

function buildDayOptions() {
  const todayKey = DAYS[new Date().getDay()];
  if (!choice.dayKey) choice.dayKey = todayKey;
  el.daySelect.innerHTML = "";
  for (let i = 1; i <= 7; i++) {
    const key = DAYS[i % 7];
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = DAY_LABELS[key] + (key === todayKey ? " (today)" : "");
    if (key === choice.dayKey) opt.selected = true;
    el.daySelect.appendChild(opt);
  }
}

function buildRouteOptions() {
  const routes = DATA.routes || [];
  const single = routes.length < 2;
  el.routeSelect.hidden = single;
  el.routeStatic.hidden = !single;

  el.routeSelect.innerHTML = "";
  for (const r of routes) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.code;
    el.routeSelect.appendChild(opt);
  }
  if (!routes.some((r) => r.id === choice.routeId)) {
    choice.routeId = routes[0] && routes[0].id;
  }
  el.routeSelect.value = choice.routeId;
}

function onRouteChange() {
  const route = currentRoute();
  if (!route) return;
  el.routeStatic.textContent = route.code;

  const stops = corridorStops(route);
  const fillSelect = (select) => {
    select.innerHTML = "";
    for (const s of stops) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
  };
  fillSelect(el.fromSelect);
  fillSelect(el.toSelect);

  const ids = stops.map((s) => s.id);
  if (!ids.includes(choice.fromId)) choice.fromId = ids[0];
  if (!ids.includes(choice.toId) || choice.toId === choice.fromId) {
    choice.toId = ids[ids.length - 1] !== choice.fromId ? ids[ids.length - 1] : ids[Math.max(0, ids.length - 2)];
  }
  el.fromSelect.value = choice.fromId;
  el.toSelect.value = choice.toId;
  saveChoice();
  render();
}

/* ---------- lookups ---------- */

function currentRoute() {
  return (DATA.routes || []).find((r) => r.id === choice.routeId) || null;
}

// Every stop served by either direction of a route, in a sensible order:
// direction[0]'s order, with direction[1]-only stops spliced in near their
// neighbours.
function corridorStops(route) {
  const dirs = route.directions;
  const order = dirs[0].stops.map((s) => s.id);
  const known = new Set(order);
  const other = dirs[1].stops.map((s) => s.id);

  other.forEach((id, i) => {
    if (known.has(id)) return;
    let afterId = null;
    for (let j = i - 1; j >= 0; j--) {
      if (known.has(other[j])) { afterId = other[j]; break; }
    }
    const at = afterId ? order.indexOf(afterId) + 1 : order.length;
    order.splice(at, 0, id);
    known.add(id);
  });

  const allStops = [...dirs[0].stops, ...dirs[1].stops];
  const nameOf = (id) => (allStops.find((s) => s.id === id) || {}).name || id;
  return order.map((id) => ({ id, name: nameOf(id) }));
}

// The direction of `route` that runs from fromId to toId (in that order), or null.
function resolveDirection(route, fromId, toId) {
  for (const dir of route.directions) {
    const ids = dir.stops.map((s) => s.id);
    const fi = ids.indexOf(fromId);
    const ti = ids.indexOf(toId);
    if (fi !== -1 && ti !== -1 && fi < ti) return dir;
  }
  return null;
}

function journeysForDay(dir) {
  const out = [];
  for (const svc of dir.services || []) {
    if (!svc.daysOfWeek.includes(choice.dayKey)) continue;
    for (const j of svc.journeys) out.push(j);
  }
  out.sort((a, b) => firstTime(a) - firstTime(b));
  return out;
}

function firstTime(journey) {
  const vals = Object.values(journey.times).filter(Boolean).map(toMinutes);
  return vals.length ? Math.min(...vals) : 1e9;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/* ---------- live delays (best-effort; absent/stale data is silently ignored) ---------- */

async function loadLiveDelays() {
  try {
    const res = await fetch("data/live-delays.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    LIVE = data && data.generatedAt ? data : null;
    render();
  } catch {
    // No live data published yet, or the fetch failed - the app already
    // works fine on the static schedule alone, so just carry on without it.
  }
}

// { delayMin, asOf } for a journey right now, or null if there's no live
// reading, it's gone stale, or the estimate looks implausible.
function liveDelayFor(journeyId) {
  if (!LIVE || !LIVE.generatedAt) return null;
  if (Date.now() - new Date(LIVE.generatedAt).getTime() > LIVE_MAX_AGE_MS) return null;
  const d = LIVE.delays && LIVE.delays[journeyId];
  if (!d || Date.now() - new Date(d.asOf).getTime() > LIVE_MAX_AGE_MS) return null;
  return d;
}

/* ---------- render ---------- */

function render() {
  const route = currentRoute();
  if (!route) return;

  if (choice.fromId === choice.toId) {
    el.routeLine.textContent = `${route.name} · ${route.operator}`;
    el.nextList.innerHTML = "";
    el.nextEmpty.hidden = true;
    el.nextNone.hidden = false;
    el.nextNone.textContent = "Pick two different stops.";
    el.timetableWrap.innerHTML = `<p class="empty">Pick two different stops.</p>`;
    return;
  }

  const dir = resolveDirection(route, choice.fromId, choice.toId);
  if (!dir) {
    el.routeLine.textContent = `${route.name} · ${route.operator}`;
    el.nextList.innerHTML = "";
    el.nextEmpty.hidden = true;
    el.nextNone.hidden = false;
    el.nextNone.textContent = `${route.code} doesn't run that way. Try the swap button.`;
    el.timetableWrap.innerHTML = `<p class="empty">${route.code} doesn't run this direction between those stops.</p>`;
    return;
  }

  el.nextNone.hidden = true;
  el.routeLine.textContent = `${dir.name} · ${route.operator}`;

  renderNext(route, dir);
  renderTimetable(dir);
}

function renderNext(route, dir) {
  const fromId = choice.fromId;
  const toId = choice.toId;
  const fromIdx = dir.stops.findIndex((s) => s.id === fromId);
  const toIdx = dir.stops.findIndex((s) => s.id === toId);

  const todayKey = DAYS[new Date().getDay()];
  const isToday = choice.dayKey === todayKey;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const rows = journeysForDay(dir)
    .map((j) => {
      const live = liveDelayFor(j.id);
      const dep = j.times[fromId];
      return { j, dep, arr: j.times[toId], live, liveDepMin: dep && live ? toMinutes(dep) + live.delayMin : null };
    })
    .filter((r) => r.dep && r.arr)
    .sort((a, b) => toMinutes(a.dep) - toMinutes(b.dep));

  // Use the live-adjusted departure (when we have one) to decide what still
  // counts as "upcoming" - a bus running late shouldn't vanish from the list
  // just because its scheduled time has technically passed.
  const list = isToday ? rows.filter((r) => (r.liveDepMin ?? toMinutes(r.dep)) >= nowMin) : rows;
  const shown = isToday ? list.slice(0, 6) : list;

  el.nextList.innerHTML = "";
  el.nextEmpty.hidden = shown.length > 0;

  for (const { j, dep, arr, live, liveDepMin } of shown) {
    const key = `${j.id}@${dep}`;
    const li = document.createElement("li");

    const btn = document.createElement("button");
    btn.className = "dep";
    btn.type = "button";
    btn.setAttribute("aria-expanded", String(expandedKey === key));

    const times = document.createElement("span");
    times.className = "dep-times";
    const depSpan = document.createElement("span");
    depSpan.className = "time";
    depSpan.textContent = dep;
    if (live) {
      const badge = document.createElement("span");
      if (live.delayMin >= 2) {
        badge.className = "live-badge late";
        badge.textContent = `live +${live.delayMin}`;
      } else if (live.delayMin <= -2) {
        badge.className = "live-badge early";
        badge.textContent = `live ${live.delayMin}`;
      } else {
        badge.className = "live-badge ontime";
        badge.textContent = "live on time";
      }
      depSpan.appendChild(badge);
    }
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "→";
    const arrSpan = document.createElement("span");
    arrSpan.className = "time arr";
    arrSpan.textContent = arr;
    times.append(depSpan, sep, arrSpan);

    const meta = document.createElement("span");
    meta.className = "dep-meta";
    const dur = document.createElement("span");
    dur.className = "duration";
    dur.textContent = `${toMinutes(arr) - toMinutes(dep)} min`;
    meta.appendChild(dur);
    if (isToday) {
      const mins = (liveDepMin ?? toMinutes(dep)) - nowMin;
      const cd = document.createElement("span");
      cd.className = "countdown";
      cd.textContent = mins <= 0 ? "due" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
      if (mins <= 15) cd.classList.add("soon");
      meta.appendChild(cd);
    }

    const chev = document.createElement("span");
    chev.className = "chevron";
    chev.textContent = "›";

    btn.append(times, meta, chev);
    btn.addEventListener("click", () => {
      expandedKey = expandedKey === key ? null : key;
      renderNext(route, dir);
    });

    li.appendChild(btn);
    if (expandedKey === key) li.appendChild(buildDetail(dir, j, fromIdx, toIdx));
    el.nextList.appendChild(li);
  }
}

function buildDetail(dir, journey, fromIdx, toIdx) {
  const wrap = document.createElement("div");
  wrap.className = "dep-detail";

  const between = dir.stops
    .slice(fromIdx + 1, toIdx)
    .map((s) => ({ s, t: journey.times[s.id] }))
    .filter((x) => x.t);

  if (!between.length) {
    const p = document.createElement("p");
    p.textContent = "No timed stops in between.";
    wrap.appendChild(p);
    return wrap;
  }

  const ul = document.createElement("ul");
  for (const x of between) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = x.s.name;
    const t = document.createElement("span");
    t.textContent = x.t;
    li.append(name, t);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderTimetable(dir) {
  const journeys = journeysForDay(dir);

  if (journeys.length === 0) {
    el.timetableWrap.innerHTML = `<p class="empty">No service on ${DAY_LABELS[choice.dayKey]}.</p>`;
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(th("Stop"));
  journeys.forEach((_, i) => headRow.appendChild(th(String(i + 1))));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const stop of dir.stops) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = stop.name;
    if (stop.id === choice.fromId || stop.id === choice.toId) name.style.fontWeight = "700";
    tr.appendChild(name);
    for (const j of journeys) {
      const cell = document.createElement("td");
      const v = j.times[stop.id];
      if (v) {
        cell.textContent = v;
      } else {
        cell.textContent = "—";
        cell.className = "skip";
      }
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  el.timetableWrap.innerHTML = "";
  el.timetableWrap.appendChild(table);
}

function th(text) {
  const c = document.createElement("th");
  c.textContent = text;
  return c;
}

/* ---------- persistence ---------- */

// Bus/From/To are remembered across visits. Day is not: it always starts on
// today's date so re-opening the app doesn't silently show a stale day.
function loadChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    delete saved.dayKey;
    return saved;
  } catch {
    return {};
  }
}

function saveChoice() {
  try {
    const { routeId, fromId, toId } = choice;
    localStorage.setItem(STORE_KEY, JSON.stringify({ routeId, fromId, toId }));
  } catch {
    /* ignore */
  }
}
