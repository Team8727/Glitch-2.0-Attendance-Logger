"use strict";

/*
 * Auto sign-out at the end of a meeting.
 *
 * Meetings are Tuesday/Thursday 3:30–5:30 PM Eastern. At 5:45 PM local, anyone
 * still signed in for that practice date is marked left at 5:30 PM. Test rows
 * are ignored.
 */

const db = require("./db");

const DEFAULT_TZ = process.env.TZ || "America/New_York";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let timer = null;

async function runOnce() {
  const tz = process.env.TZ || DEFAULT_TZ;
  const result = await db.query(
    `UPDATE attendance
        SET left_at = (practice_date + time '17:30') AT TIME ZONE $1
      WHERE left_at IS NULL
        AND is_test = false
        AND practice_date = (now() AT TIME ZONE $1)::date
        AND EXTRACT(ISODOW FROM practice_date) IN (2, 4)
        AND (now() AT TIME ZONE $1)::time >= time '17:45'`,
    [tz]
  );
  if (result.rowCount > 0) {
    console.log(`[auto-signout] signed out ${result.rowCount} member(s) at 17:30`);
  }
  return result.rowCount;
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => console.error("[auto-signout] failed:", err.message));
  }, CHECK_INTERVAL_MS);
  timer.unref();
  runOnce().catch((err) => console.error("[auto-signout] failed:", err.message));
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce };
