"use strict";

/*
 * One-way Google Sheets reporting sync.
 *
 * Postgres is the source of truth. This module pushes:
 *   - new attendance rows to the Sign-ins tab
 *   - member status to the Members/Roster tab
 *
 * It never reads roster data back from Sheets.
 */

const fs = require("fs");
const path = require("path");

const repo = require("./repository");

const DEFAULT_STATE_FILE = path.join(__dirname, "data", "sheet-sync.json");
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

async function pendingRows() {
  const rows = await repo.allAttendance();
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
    const rows = await pendingRows();
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

async function pushRosterStatus() {
  const rows = await repo.memberStatusRows();
  const data = await callWebhook({ action: "updateRosterStatus", rows });
  lastRosterSync = new Date().toISOString();
  lastRosterError = null;
  lastRosterCount = rows.length;
  console.log(`[sheets] member status pushed — ${rows.length} member(s)`);
  return { ok: true, rosterCount: rows.length, updated: Number(data.updated) || 0 };
}

async function syncRoster() {
  try {
    return await pushRosterStatus();
  } catch (err) {
    lastRosterError = err.name === "AbortError" ? "Sheets webhook timed out." : err.message;
    console.error("[sheets] member status push failed:", lastRosterError);
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
