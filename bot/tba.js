"use strict";

/*
 * The Blue Alliance client — team info for the rotating 4-digit code.
 *
 *   lookup(n) -> { status: "ok", team }   registered FRC team (name/city/state)
 *             -> { status: "unused" }     404 — not a registered team number
 *             -> { status: "down" }       network error, timeout, bad key, 5xx
 *
 * Successful lookups are cached in data/tba-cache.json (30-day TTL) and are
 * served from cache while fresh, so re-picking a known number costs no API
 * call. get(n) reads the cache only — used by the display API and as the
 * degraded fallback when TBA is unreachable.
 */

const fs = require("fs");
const path = require("path");

const API_BASE = "https://www.thebluealliance.com/api/v3";
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CACHE_FILE = path.join(__dirname, "data", "tba-cache.json");

let queue = Promise.resolve();

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[tba] could not read cache:", err.message);
    }
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.error("[tba] could not save cache:", err.message);
  }
}

function mutateCache(fn) {
  const run = queue.then(() => {
    const cache = loadCache();
    const result = fn(cache);
    saveCache(cache);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function ageOf(entry) {
  const stamp = Date.parse(entry && entry.fetchedAt ? entry.fetchedAt : "");
  return Number.isFinite(stamp) ? Date.now() - stamp : Infinity;
}

async function lookup(teamNumber) {
  const number = Number(teamNumber);
  if (!Number.isInteger(number)) return { status: "down" };

  const cached = loadCache()[String(number)];
  if (cached && ageOf(cached) < CACHE_TTL_MS) {
    return { status: "ok", team: cached, cached: true };
  }
  if (!process.env.TBA_AUTH_KEY) return { status: "down" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}/team/frc${number}`, {
      headers: { "X-TBA-Auth-Key": process.env.TBA_AUTH_KEY },
      signal: controller.signal,
    });
  } catch (err) {
    return { status: "down" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return { status: "unused" };
  if (res.status !== 200) return { status: "down" }; // bad key or outage

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { status: "down" };
  }

  const team = {
    nickname: String(data.nickname || ""),
    city: String(data.city || ""),
    state_prov: String(data.state_prov || ""),
    fetchedAt: new Date().toISOString(),
  };
  await mutateCache((cache) => {
    cache[String(number)] = team;
  });
  return { status: "ok", team };
}

function get(teamNumber) {
  const entry = loadCache()[String(Number(teamNumber))];
  if (!entry) return null;
  return {
    name: entry.nickname || null,
    city: entry.city || null,
    state: entry.state_prov || null,
  };
}

function newest() {
  const cache = loadCache();
  let best = null;
  for (const key of Object.keys(cache)) {
    const number = Number(key);
    const age = ageOf(cache[key]);
    if (!Number.isInteger(number) || !Number.isFinite(age)) continue;
    if (!best || age < best.age) best = { number, age };
  }
  return best ? best.number : null;
}

module.exports = { lookup, get, newest };
