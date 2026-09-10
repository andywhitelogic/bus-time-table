"use strict";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS = {
  Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday",
};
const STORE_KEY = "bus-times-choice";

const el = {
  routeTitle: document.getElementById("route-title"),
  routeSubtitle: document.getElementById("route-subtitle"),
  routeField: document.getElementById("route-field"),
  routeSelect: document.getElementById("route-select"),
  directionSelect: document.getElementById("direction-select"),
  stopSelect: document.getElementById("stop-select"),
  daySelect: document.getElementById("day-select"),
  nextList: document.getElementById("next-list"),
  nextEmpty: document.getElementById("next-empty"),
  toggleTimetable: document.getElementById("toggle-timetable"),
  timetableWrap: document.getElementById("timetable-wrap"),
  dataNote: document.getElementById("data-note"),
};

let DATA = null;
let choice = loadChoice();
let tick = null;

init();

async function init() {
  try {
    const res = await fetch("data/timetable.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    el.routeSubtitle.textContent = "Could not load timetable data.";
    console.error(err);
    return;
  }

  buildDayOptions();
  buildRouteOptions();

  el.routeSelect.addEventListener("change", () => {
    choice.routeId = el.routeSelect.value;
    choice.directionId = null;
    choice.stopId = null;
    saveChoice();
    onRouteChange();
  });
  el.directionSelect.addEventListener("change", () => {
    choice.directionId = el.directionSelect.value;
    choice.stopId = null;
    saveChoice();
    onDirectionChange();
  });
  el.stopSelect.addEventListener("change", () => {
    choice.stopId = el.stopSelect.value;
    saveChoice();
    render();
  });
  el.daySelect.addEventListener("change", () => {
    choice.dayKey = el.daySelect.value;
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

  if (DATA.meta && DATA.meta.note) {
    el.dataNote.textContent = DATA.meta.note;
  }

  // Refresh countdowns every 30s.
  tick = setInterval(render, 30000);
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
  el.routeField.hidden = routes.length < 2;
  el.routeSelect.innerHTML = "";
  for (const r of routes) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${r.code} — ${r.name}`;
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
  el.routeTitle.textContent = `${route.code} ${route.operator ? "· " + route.operator : ""}`.trim();
  el.routeSubtitle.textContent = route.name;

  el.directionSelect.innerHTML = "";
  for (const d of route.directions) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    el.directionSelect.appendChild(opt);
  }
  if (!route.directions.some((d) => d.id === choice.directionId)) {
    choice.directionId = route.directions[0] && route.directions[0].id;
  }
  el.directionSelect.value = choice.directionId;
  onDirectionChange();
}

function onDirectionChange() {
  const dir = currentDirection();
  if (!dir) return;
  el.stopSelect.innerHTML = "";
  for (const s of dir.stops) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    el.stopSelect.appendChild(opt);
  }
  if (!dir.stops.some((s) => s.id === choice.stopId)) {
    choice.stopId = dir.stops[0] && dir.stops[0].id;
  }
  el.stopSelect.value = choice.stopId;
  saveChoice();
  render();
}

/* ---------- lookups ---------- */

function currentRoute() {
  return (DATA.routes || []).find((r) => r.id === choice.routeId) || null;
}
function currentDirection() {
  const route = currentRoute();
  if (!route) return null;
  return route.directions.find((d) => d.id === choice.directionId) || null;
}

// All journeys that run on the chosen day, flattened across matching services.
function journeysForDay() {
  const dir = currentDirection();
  if (!dir) return [];
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

/* ---------- render ---------- */

function render() {
  renderNext();
  renderTimetable();
}

function renderNext() {
  const dir = currentDirection();
  const stopId = choice.stopId;
  if (!dir || !stopId) return;

  const todayKey = DAYS[new Date().getDay()];
  const isToday = choice.dayKey === todayKey;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let times = journeysForDay()
    .map((j) => j.times[stopId])
    .filter(Boolean)
    .map(toMinutes)
    .sort((a, b) => a - b);

  let upcoming = isToday ? times.filter((t) => t >= nowMin) : times;
  const shown = upcoming.slice(0, isToday ? 4 : upcoming.length);

  el.nextList.innerHTML = "";
  el.nextEmpty.hidden = shown.length > 0;

  for (const t of shown) {
    const li = document.createElement("li");
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = fmt(t);
    const cd = document.createElement("span");
    cd.className = "countdown";
    if (isToday) {
      const mins = t - nowMin;
      cd.textContent = mins <= 0 ? "due" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
      if (mins <= 15) cd.classList.add("soon");
    }
    li.append(time, cd);
    el.nextList.appendChild(li);
  }
}

function renderTimetable() {
  const dir = currentDirection();
  if (!dir) return;
  const journeys = journeysForDay();

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
    if (stop.id === choice.stopId) name.style.fontWeight = "700";
    tr.appendChild(name);
    for (const j of journeys) {
      const td = document.createElement("td");
      const v = j.times[stop.id];
      if (v) {
        td.textContent = v;
      } else {
        td.textContent = "—";
        td.className = "skip";
      }
      tr.appendChild(td);
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

function fmt(min) {
  const h = String(Math.floor(min / 60) % 24).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/* ---------- persistence ---------- */

function loadChoice() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveChoice() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(choice));
  } catch {
    /* ignore */
  }
}
