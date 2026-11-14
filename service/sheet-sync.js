"use strict";

/*
 * Background Google Sheets sync.
 *
 * - Appends new sign-ins to the Sign-ins tab.
 * - Pulls the Roster tab into service/data/roster-sheet.json on demand.
 * - Writes PIN/Discord status back to the Roster tab.
 *
 * The service never blocks sign-ins on Sheets. If the webhook is down, rows stay
 * in signins.json and are retried next interval. The Apps Script dedupes.
 */

const fs = require("fs");
const path = require("path");

const attendance = require("./attendance");
const roster = require("./roster");
const pins = require("./pins");
const store = require("./store");

const DEFAULT_STATE_FILE = path.join(__dirname, "data", "sheet-sync.json");
const DEFAULT_ROSTER_FILE = path.join(__dirname, "data", "roster-sheet.json");
const DEFAULT_INTERVAL_MS = 60000;

let timer = null;
let running = false;
let lastSync = null;
let lastError = null;
let lastAppended = 0;
let lastRosterSync = null;
let lastRosterError = null;
let lastRosterCount = 0;

function stateFile() {
  return process.env.SHEETS_SYNC_STATE_FILE || DEFAULT_STATE_FILE;
}

function rosterFile() {
  return process.env.ROSTER_JSON || DEFAULT_ROSTER_FILE;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[sheets] could not read sync state:", err.message);
    }
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    const tmp = stateFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, stateFile());
  } catch (err) {
    console.error("[sheets] could not save sync state:", err.message);
  }
}

function saveRoster(rows) {
  try {
    fs.mkdirSync(path.dirname(rosterFile()), { recursive: true });
    const tmp = rosterFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, rosterFile());
  } catch (err) {
    console.error("[sheets] could not save roster cache:", err.message);
  }
}

function pendingRows() {
  const rows = attendance.all();
  const state = loadState();
  if (!state.lastTs) return rows;
  const index = rows.findIndex(
    (row) => row.ts === state.lastTs && row.name === state.lastName
  );
  return index === -1 ? rows : rows.slice(index + 1);
}

async function callWebhook(payload) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("Sheets webhook is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...payload }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  if (!response.ok || !data || data.ok !== true) {
    throw new Error(
      (data && (data.error || data.message)) || `Sheets webhook returned HTTP ${response.status}.`
    );
  }
  return data;
}

async function syncOnce() {
  if (!process.env.SHEETS_WEBHOOK_URL || !process.env.SHEETS_WEBHOOK_SECRET) {
    return { ok: true, skipped: true, appended: 0 };
  }
  if (running) return { ok: true, skipped: true, appended: 0 };

  running = true;
  try {
    const rows = pendingRows();
    if (rows.length === 0) {
      lastSync = new Date().toISOString();
      lastError = null;
      return { ok: true, appended: 0 };
    }

    const data = await callWebhook({ action: "syncSignins", rows });
    const last = rows[rows.length - 1];
    saveState({ lastTs: last.ts, lastName: last.name });
    lastSync = new Date().toISOString();
    lastError = null;
    lastAppended = Number(data.appended) || rows.length;
    console.log(`[sheets] appended ${lastAppended} row(s)`);
    return { ok: true, appended: lastAppended };
  } catch (err) {
    lastError = err.name === "AbortError" ? "Sheets webhook timed out." : err.message;
    console.error("[sheets] sync failed:", lastError);
    return { ok: false, error: lastError };
  } finally {
    running = false;
  }
}

async function fetchRoster() {
  const data = await callWebhook({ action: "getRoster" });
  if (!Array.isArray(data.roster)) {
    throw new Error(
      "Sheets webhook did not return a roster. Update the Apps Script deployment to the latest Code.gs."
    );
  }
  const rows = data.roster;
  saveRoster(rows);
  lastRosterSync = new Date().toISOString();
  lastRosterError = null;
  lastRosterCount = rows.length;
  console.log(`[sheets] roster synced — ${rows.length} member(s)`);
  return rows;
}

async function pushRosterStatus() {
  const members = roster.load();
  const links = store.all();
  const byName = new Map(
    Object.entries(links).map(([id, name]) => [String(name).trim().toLowerCase(), id])
  );
  const rows = members.map((member) => ({
    name: member.name,
    subteam: member.subteam || "",
    hasPin: pins.has(member.name),
    discordId: byName.get(member.name.toLowerCase()) || "",
  }));
  const data = await callWebhook({ action: "updateRosterStatus", rows });
  return data;
}

async function syncRoster() {
  try {
    const rows = await fetchRoster();
    const result = await pushRosterStatus();
    return { ok: true, rosterCount: rows.length, updated: Number(result.updated) || 0 };
  } catch (err) {
    lastRosterError = err.name === "AbortError" ? "Sheets webhook timed out." : err.message;
    console.error("[sheets] roster sync failed:", lastRosterError);
    return { ok: false, error: lastRosterError };
  }
}

function start() {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.log("[sheets] sync disabled — SHEETS_WEBHOOK_URL/SHEETS_WEBHOOK_SECRET not set.");
    return;
  }
  const interval = Number(process.env.SHEETS_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  if (!timer) {
    timer = setInterval(() => {
      syncOnce().catch((err) => console.error("[sheets] unexpected error:", err.message));
    }, Math.max(15000, interval));
    timer.unref();
    syncOnce().catch((err) => console.error("[sheets] unexpected error:", err.message));
  }
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function status() {
  return {
    enabled: Boolean(process.env.SHEETS_WEBHOOK_URL && process.env.SHEETS_WEBHOOK_SECRET),
    lastSync,
    lastError,
    lastAppended,
    lastRosterSync,
    lastRosterError,
    lastRosterCount,
  };
}

module.exports = { start, stop, syncOnce, syncRoster, pushRosterStatus, status };
