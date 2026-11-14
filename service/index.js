"use strict";

/*
 * Glitch 2.0 attendance service.
 *
 * Postgres is the source of truth. This process owns the rotating team-number
 * code, the HTTP API, and the one-way Google Sheets reporting sync. It does NOT
 * connect to Discord. The Discord bot lives in the separate
 * `glitch-2.0-discord-bot` repo and calls the internal API routes with BOT_API_KEY.
 */

const db = require("./db");
const repo = require("./repository");
const codes = require("./codes");
const server = require("./server");
const sheetSync = require("./sheet-sync");

async function main() {
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

  await db.init();
  const members = await repo.listMembers();
  console.log(`[startup] Roster loaded — ${members.length} members.`);

  const httpServer = await server.start();
  codes.start();
  sheetSync.start();

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} received — stopping.`);
    codes.stop();
    sheetSync.stop();
    httpServer.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
