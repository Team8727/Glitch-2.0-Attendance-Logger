"use strict";

/*
 * Attendance rows for data/signins.json — an array of { ts, name, code }.
 * Same promise-queue + atomic-write pattern as store.js, but the file holds
 * an array rather than an object map.
 *
 * Day boundaries use the server's local timezone (set TZ, e.g. America/Chicago)
 * so "today" matches what the team calls a practice day.
 */

const fs = require("fs");
const path = require("path");

const SIGNINS_FILE = path.join(__dirname, "data", "signins.json");
const MAX_CODE_LENGTH = 24;

let queue = Promise.resolve();

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(SIGNINS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[attendance] could not read sign-ins:", err.message);
    }
    return [];
  }
}

function save(rows) {
  try {
    fs.mkdirSync(path.dirname(SIGNINS_FILE), { recursive: true });
    const tmp = SIGNINS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, SIGNINS_FILE);
  } catch (err) {
    console.error("[attendance] could not save sign-ins:", err.message);
  }
}

function mutate(fn) {
  const run = queue.then(() => {
    const rows = load();
    const result = fn(rows);
    save(rows);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function toDate(ts) {
  return new Date(ts);
}

function dateTag(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeTag(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function isRealDate(date) {
  return !Number.isNaN(date.getTime());
}

function signIn(name, code) {
  return mutate((rows) => {
    const canonical = String(name || "").trim();
    if (!canonical) return { ok: false, error: "Missing member name." };
    const today = dateTag(new Date());
    const key = canonical.toLowerCase();

    for (const row of rows) {
      const rowDate = toDate(row.ts);
      if (!isRealDate(rowDate)) continue;
      if (String(row.name || "").trim().toLowerCase() !== key) continue;
      if (dateTag(rowDate) === today) {
        return { ok: false, already: true, error: "You're already signed in for today." };
      }
    }

    rows.push({
      ts: new Date().toISOString(),
      name: canonical,
      code: String(code || "").slice(0, MAX_CODE_LENGTH),
    });
    return { ok: true, name: canonical };
  });
}

function todayList() {
  const today = dateTag(new Date());
  const members = load()
    .filter((row) => {
      const date = toDate(row.ts);
      return isRealDate(date) && dateTag(date) === today;
    })
    .map((row) => ({ name: row.name, at: timeTag(toDate(row.ts)) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { date: today, count: members.length, members };
}

function seasonStats() {
  const rows = load();
  const practiceDates = new Set();
  const counts = new Map();
  for (const row of rows) {
    const date = toDate(row.ts);
    if (isRealDate(date)) practiceDates.add(dateTag(date));
    const name = String(row.name || "Unknown");
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const members = Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  return { practices: practiceDates.size, signins: rows.length, members };
}

module.exports = { signIn, todayList, seasonStats };
