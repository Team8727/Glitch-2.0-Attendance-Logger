"use strict";

/*
 * Glitch 2.0 attendance service.
 *
 * This process owns the attendance domain: the rotating team-number code, the
 * roster, the JSON stores, and the HTTP API. It does NOT connect to Discord.
 * The Discord bot lives in the separate `glitch-2.0-discord-bot` repo and calls
 * the internal API routes with BOT_API_KEY.
 */

const fs = require("fs");
const path = require("path");

const roster = require("./roster");
const codes = require("./codes");
const server = require("./server");
const sheetSync = require("./sheet-sync");

/* ---------- minimal .env loader (real env vars take precedence) ---------- */

function loadEnvFile() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile();

  if (!process.env.BOT_API_KEY) {
    console.warn(
      "[startup] BOT_API_KEY is not set — internal /api/link and /api/signin routes are disabled. " +
        "Set it to the same value used by the Discord bot."
    );
  }
  if (!process.env.TBA_AUTH_KEY) {
    console.warn(
      "[startup] TBA_AUTH_KEY is not set — team validation is disabled. " +
        "Sign-ins only work while a cached team exists (degraded mode)."
    );
  }

  try {
    const members = roster.load();
    console.log(`[startup] Roster loaded — ${members.length} members.`);
  } catch (err) {
    console.error("[startup] Roster not readable yet:", err.message);
  }

  const httpServer = await server.start();
  codes.start();
  sheetSync.start();

  const shutdown = (signal) => {
    console.log(`[shutdown] ${signal} received — stopping.`);
    codes.stop();
    sheetSync.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
