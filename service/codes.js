"use strict";

/*
 * Rotating 4-digit sign-in code.
 *
 * Window = 60s: windowIndex = floor(Date.now() / 60000). The sign-in code is
 * the FRC team number picked for that window — a random 1000–9999 number that
 * The Blue Alliance confirms is a real team, so the site can show its name and
 * City, State underneath.
 *
 * A tick every few seconds (setInterval, not setTimeout — window drift) checks
 * whether the window changed and whether a pre-fetch is due ~30s before the
 * flip. State is persisted to data/code-state.json so a restart mid-window
 * doesn't strand students.
 *
 * Validation accepts the current window's number plus the previous window's
 * (grace for a read taken right before a flip). When TBA is unreachable at a
 * flip we degrade: reuse the last known valid team rather than showing nothing.
 */

const fs = require("fs");
const path = require("path");

const tba = require("./tba");

const WINDOW_MS = 60000;
const TICK_MS = 5000;
const PREFETCH_LEAD_MS = 30000;
const MAX_ATTEMPTS = 10;
const RECENT_LIMIT = 20;

const STATE_FILE = path.join(__dirname, "data", "code-state.json");

let state = null; // { windowStart, current, previous }
let pending = null; // { teamNumber } pre-fetched for the next window
let recent = []; // last RECENT_LIMIT numbers, so repeats stay rare
let timer = null;
let tickBusy = false;
let pickInFlight = null;

function windowIndexAt(ms) {
  return Math.floor(ms / WINDOW_MS);
}

function randomTeam() {
  return 1000 + Math.floor(Math.random() * 9000);
}

function loadPersisted() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const windowStart = Number(data && data.windowStart);
    const current = Number(data && data.current);
    const previous = data && data.previous != null ? Number(data.previous) : NaN;
    if (!Number.isFinite(windowStart) || windowStart % WINDOW_MS !== 0) return null;
    if (!Number.isInteger(current)) return null;
    return {
      windowStart,
      current,
      previous: Number.isInteger(previous) ? previous : null,
    };
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[codes] could not read state:", err.message);
    }
    return null;
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          windowStart: state.windowStart,
          current: state.current,
          previous: state.previous,
        },
        null,
        2
      )
    );
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error("[codes] could not save state:", err.message);
  }
}

function remember(number) {
  recent = recent.filter((n) => n !== number);
  recent.push(number);
  while (recent.length > RECENT_LIMIT) recent.shift();
}

/* One validated random team, or null on outage / exhausted retries.
   A 404 means "unused number" -> try another draw; any other failure means
   TBA is down -> give up immediately so an outage doesn't burn all attempts. */
function pickValidTeam() {
  if (pickInFlight) return pickInFlight;
  pickInFlight = (async () => {
    let attempts = 0;
    let tries = 0;
    while (attempts < MAX_ATTEMPTS && tries < 100) {
      tries += 1;
      const number = randomTeam();
      if (recent.indexOf(number) !== -1) continue;
      attempts += 1;
      const result = await tba.lookup(number);
      if (result.status === "unused") continue;
      if (result.status === "down") return null;
      return number;
    }
    return null;
  })();
  pickInFlight = pickInFlight.finally(() => {
    pickInFlight = null;
  });
  return pickInFlight;
}

function install(nowIdx, number, degraded) {
  const previous = state && state.current != null ? state.current : null;
  state = { windowStart: nowIdx * WINDOW_MS, current: number, previous };
  pending = null;
  remember(number);
  persist();
  console.log(
    `[codes] window ${nowIdx}: team ${number}` +
      (previous != null && previous !== number ? ` (previous ${previous})` : "") +
      (degraded ? " [degraded — TBA unavailable]" : "")
  );
}

async function rollWindow(nowIdx) {
  let number = pending ? pending.teamNumber : await pickValidTeam();
  let degraded = false;
  if (number == null) {
    // Degraded: reuse the last known valid team; on a cold start with no
    // state, fall back to the newest team in the TBA cache.
    number = state && state.current != null ? state.current : tba.newest();
    degraded = true;
  }
  if (number == null) {
    pending = null;
    console.warn("[codes] no team code available yet — retrying next tick");
    return;
  }
  install(nowIdx, number, degraded);
}

async function tick() {
  if (tickBusy) return;
  tickBusy = true;
  try {
    const nowIdx = windowIndexAt(Date.now());
    if (!state || windowIndexAt(state.windowStart) !== nowIdx) {
      await rollWindow(nowIdx);
      return;
    }
    if (!pending) {
      const msToFlip = state.windowStart + WINDOW_MS - Date.now();
      if (msToFlip <= PREFETCH_LEAD_MS) {
        pickValidTeam()
          .then((number) => {
            if (number != null) pending = { teamNumber: number };
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error("[codes] tick error:", err.message);
  } finally {
    tickBusy = false;
  }
}

function fresh() {
  if (!state) return null;
  if (windowIndexAt(state.windowStart) !== windowIndexAt(Date.now())) return null;
  return state;
}

function current() {
  const active = fresh();
  if (!active) return null;
  const msLeft = active.windowStart + WINDOW_MS - Date.now();
  return {
    teamNumber: active.current,
    secondsRemaining: Math.max(0, Math.ceil(msLeft / 1000)),
  };
}

function isValid(code) {
  const active = fresh();
  if (!active) return false;
  if (!/^\d{4}$/.test(String(code))) return false;
  const number = Number(code);
  if (number === active.current) return true;
  return active.previous != null && number === active.previous;
}

function start() {
  state = loadPersisted();
  recent = [];
  if (state) {
    if (state.current != null) remember(state.current);
    if (state.previous != null) remember(state.previous);
  }
  if (!timer) {
    timer = setInterval(tick, TICK_MS);
    tick();
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, current, isValid };
