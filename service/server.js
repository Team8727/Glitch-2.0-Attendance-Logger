"use strict";

/*
 * HTTP API for the attendance system.
 *
 * Public (display site):
 *   GET /api/state   -> rotating code, team info, today + season attendance
 *   GET /api/health  -> liveness probe
 *
 * Internal (Discord bot connector, requires BOT_API_KEY):
 *   POST /api/link              { discordId, name }
 *   GET  /api/link/:discordId
 *   POST /api/signin            { discordId, code }
 *
 * The internal routes are disabled unless BOT_API_KEY is set. The bot sends
 * the key in `X-Bot-Key` (or `Authorization: Bearer ...`). This keeps the
 * attendance data writable only by the bot, while the display stays public.
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const codes = require("./codes");
const repo = require("./repository");
const sheetSync = require("./sheet-sync");
const tba = require("./tba");

const MAX_BODY_BYTES = 16 * 1024;
const KIOSK_DIR = path.join(__dirname, "kiosk");

function sendJson(res, status, payload, cors) {
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (cors) headers["Access-Control-Allow-Origin"] = "*";
  res.writeHead(status, headers);
  res.end(body);
}

function sendError(res, status, error, cors) {
  sendJson(res, status, { ok: false, error }, cors);
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(Object.assign(new Error("Invalid JSON body."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  const expected = process.env.BOT_API_KEY;
  if (!expected) return false;
  const headerKey = req.headers["x-bot-key"];
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided = headerKey || bearer;
  return Boolean(provided) && safeEqual(provided, expected);
}

function requireBot(req, res) {
  if (!process.env.BOT_API_KEY) {
    sendError(res, 503, "Internal API is disabled: BOT_API_KEY is not set.", false);
    return false;
  }
  if (!isAuthorized(req)) {
    sendError(res, 401, "Unauthorized.", false);
    return false;
  }
  return true;
}

function pushSheetStatus() {
  if (!process.env.SHEETS_WEBHOOK_URL || !process.env.SHEETS_WEBHOOK_SECRET) return;
  sheetSync.pushRosterStatus().catch((err) => {
    console.error("[sheets] roster status push failed:", err.message);
  });
}

function requireKiosk(res, token) {
  const expected = process.env.KIOSK_TOKEN;
  if (!expected) {
    sendError(res, 503, "Kiosk is disabled: KIOSK_TOKEN is not set.", false);
    return false;
  }
  if (!token || !safeEqual(token, expected)) {
    sendError(res, 401, "Unauthorized.", false);
    return false;
  }
  return true;
}

async function unlinkedMembers() {
  return repo.listMembers({ unlinkedOnly: true });
}

function serveKiosk(req, res, pathname) {
  const files = {
    "/kiosk": ["index.html", "text/html; charset=utf-8"],
    "/kiosk/": ["index.html", "text/html; charset=utf-8"],
    "/kiosk/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/kiosk/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  const entry = files[pathname];
  if (!entry) return false;
  const full = path.join(KIOSK_DIR, entry[0]);
  if (!full.startsWith(KIOSK_DIR)) return false;
  try {
    const body = fs.readFileSync(full);
    res.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-store" });
    res.end(body);
    return true;
  } catch (err) {
    return false;
  }
}

async function handleKioskRoster(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (!requireKiosk(res, url.searchParams.get("token"))) return;
  try {
    const members = await unlinkedMembers();
    return sendJson(res, 200, { ok: true, members }, false);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
}

async function handleKioskSetPin(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }
  if (!requireKiosk(res, body.token)) return;

  const name = String(body.name || "").trim();
  const code = String(body.code || "").trim();
  const pin = String(body.pin || "").trim();
  const subteam = String(body.subteam || "").trim();
  const test = Boolean(body.test);
  if (!name) return sendError(res, 400, "Select your name.", false);
  if (!subteam) {
    return sendJson(
      res,
      400,
      { ok: false, error: "missing_subteam", message: "Select your subteam." },
      false
    );
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return sendJson(
      res,
      400,
      { ok: false, error: "invalid_pin_format", message: "Use a 4–6 digit PIN." },
      false
    );
  }
  if (!/^\d{4}$/.test(code)) {
    return sendJson(
      res,
      400,
      { ok: false, error: "invalid_format", message: "Enter the 4-digit code from the display." },
      false
    );
  }

  let members;
  try {
    members = await unlinkedMembers();
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
  const match = members.find((member) => member.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    return sendJson(
      res,
      404,
      {
        ok: false,
        error: "not_eligible",
        message:
          "That name isn't available for kiosk sign-in. It may already be linked to Discord, or not on the roster.",
      },
      false
    );
  }
  if (await repo.hasPin(match.name)) {
    return sendJson(
      res,
      409,
      {
        ok: false,
        error: "pin_exists",
        message: "A PIN is already set for that name. Ask a mentor to reset it.",
      },
      false
    );
  }
  if (!codes.current()) {
    return sendJson(
      res,
      503,
      {
        ok: false,
        error: "code_unavailable",
        message: "Sign-ins aren't open yet — the display hasn't picked a team code. Try again in a minute.",
      },
      false
    );
  }
  if (!codes.isValid(code)) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error: "invalid_code",
        message: "That's not the current team number — re-read the display and try again.",
      },
      false
    );
  }

  await repo.setSubteam(match.name, subteam);
  await repo.setPin(match.name, pin);
  pushSheetStatus();
  const result = await repo.signIn(match.name, code, "kiosk", { test });
  if (result && result.already) {
    return sendJson(res, 200, { ok: true, name: match.name, already: true }, false);
  }
  if (!result || result.ok !== true) {
    return sendJson(
      res,
      500,
      {
        ok: false,
        error: "signin_failed",
        message: `Sign-in failed: ${(result && result.error) || "unknown error — ask a mentor."}`,
      },
      false
    );
  }
  return sendJson(res, 200, { ok: true, name: result.name || match.name }, false);
}

async function handleMentorRoster(req, res) {
  if (!requireBot(req, res)) return;
  try {
    const members = await repo.listMembers();
    return sendJson(res, 200, { ok: true, members }, false);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
}

async function handleStats(req, res) {
  if (!requireBot(req, res)) return;
  try {
    const data = await repo.stats();
    return sendJson(res, 200, { ok: true, ...data }, false);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
}

async function handleAttendanceToday(req, res) {
  if (!requireBot(req, res)) return;
  try {
    const data = await repo.todayList();
    return sendJson(res, 200, { ok: true, ...data }, false);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
}

async function handleSignOut(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }
  const discordId = String(body.discordId || "").trim();
  if (!discordId) return sendError(res, 400, "Missing discordId.", false);

  const member = await repo.getMemberByDiscordId(discordId);
  if (!member) {
    return sendJson(
      res,
      409,
      {
        ok: false,
        error: "not_linked",
        message: "You're not linked yet. Run `/link <your name>` first.",
      },
      false
    );
  }

  const result = await repo.signOut(member.name);
  if (!result.ok) {
    if (result.already) {
      return sendJson(
        res,
        409,
        {
          ok: false,
          already: true,
          error: "already_signed_out",
          message: "You're already signed out for today.",
        },
        false
      );
    }
    if (result.error === "not_signed_in") {
      return sendJson(
        res,
        409,
        { ok: false, error: "not_signed_in", message: "You're not signed in today." },
        false
      );
    }
    return sendJson(
      res,
      500,
      { ok: false, error: "signout_failed", message: "Sign-out failed — ask a mentor." },
      false
    );
  }
  return sendJson(
    res,
    200,
    { ok: true, name: result.name, durationMinutes: result.durationMinutes },
    false
  );
}

async function handleMentorAddMember(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const subteam = String(body.subteam || "").trim();
  if (!firstName || !lastName) {
    return sendError(res, 400, "First and last name are required.", false);
  }
  try {
    const member = await repo.addMember(firstName, lastName, subteam);
    pushSheetStatus();
    return sendJson(res, 200, { ok: true, member }, false);
  } catch (err) {
    if (err.code === "23505") {
      return sendJson(
        res,
        409,
        { ok: false, error: "member_exists", message: "That member already exists." },
        false
      );
    }
    return sendError(res, 500, err.message, false);
  }
}

async function handleMentorSignIn(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }

  const name = String(body.name || "").trim();
  if (!name) return sendError(res, 400, "Select a member.", false);

  let match;
  try {
    match = await repo.findMember(name);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
  if (!match) {
    return sendJson(
      res,
      404,
      { ok: false, error: "not_on_roster", message: "That name isn't on the roster." },
      false
    );
  }

  const result = await repo.signIn(match.name, "mentor", "mentor", { test: false });
  if (!result || result.ok !== true) {
    if (result && result.already) {
      return sendJson(
        res,
        409,
        {
          ok: false,
          already: true,
          error: "already_signed_in",
          message: "That member is already signed in for today.",
        },
        false
      );
    }
    return sendJson(
      res,
      500,
      {
        ok: false,
        error: "signin_failed",
        message: `Sign-in failed: ${(result && result.error) || "unknown error — ask a mentor."}`,
      },
      false
    );
  }
  return sendJson(res, 200, { ok: true, name: result.name || match.name }, false);
}

async function handleKioskSignIn(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }
  if (!requireKiosk(res, body.token)) return;

  const name = String(body.name || "").trim();
  const code = String(body.code || "").trim();
  const test = Boolean(body.test);
  if (!name) return sendError(res, 400, "Select your name.", false);
  if (!/^\d{4}$/.test(code)) {
    return sendJson(
      res,
      400,
      { ok: false, error: "invalid_format", message: "Enter the 4-digit code from the display." },
      false
    );
  }

  let members;
  try {
    members = await unlinkedMembers();
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
  const match = members.find((member) => member.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    return sendJson(
      res,
      404,
      {
        ok: false,
        error: "not_eligible",
        message:
          "That name isn't available for kiosk sign-in. It may already be linked to Discord, or not on the roster.",
      },
      false
    );
  }

  if (!codes.current()) {
    return sendJson(
      res,
      503,
      {
        ok: false,
        error: "code_unavailable",
        message: "Sign-ins aren't open yet — the display hasn't picked a team code. Try again in a minute.",
      },
      false
    );
  }
  if (!codes.isValid(code)) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error: "invalid_code",
        message: "That's not the current team number — re-read the display and try again.",
      },
      false
    );
  }

  if (!(await repo.hasPin(match.name))) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error: "pin_required",
        message: "First time? Set a PIN before signing in.",
      },
      false
    );
  }
  const pin = String(body.pin || "").trim();
  if (!pin) {
    return sendJson(
      res,
      400,
      { ok: false, error: "pin_required", message: "Enter your PIN." },
      false
    );
  }
  if (!(await repo.verifyPin(match.name, pin))) {
    return sendJson(
      res,
      401,
      { ok: false, error: "invalid_pin", message: "That PIN is incorrect." },
      false
    );
  }

  const result = await repo.signIn(match.name, code, "kiosk", { test });
  if (!result || result.ok !== true) {
    if (result && result.already) {
      return sendJson(
        res,
        409,
        { ok: false, already: true, error: "already_signed_in", message: "You're already signed in for today." },
        false
      );
    }
    return sendJson(
      res,
      500,
      {
        ok: false,
        error: "signin_failed",
        message: `Sign-in failed: ${(result && result.error) || "unknown error — ask a mentor."}`,
      },
      false
    );
  }
  return sendJson(res, 200, { ok: true, name: result.name || match.name }, false);
}

async function buildState() {
  const active = codes.current();
  let code = null;
  let team = null;

  if (active) {
    code = {
      teamNumber: active.teamNumber,
      secondsRemaining: active.secondsRemaining,
    };
    const info = tba.get(active.teamNumber);
    team = {
      number: active.teamNumber,
      name: info ? info.name : null,
      city: info ? info.city : null,
      state: info ? info.state : null,
    };
  }

  return {
    ok: true,
    code,
    team,
    today: await repo.todayList(),
    season: await repo.seasonStats(),
  };
}

async function handleLink(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }

  const discordId = String(body.discordId || "").trim();
  const name = String(body.name || "").trim();
  const subteam = String(body.subteam || "").trim();
  if (!discordId) return sendError(res, 400, "Missing discordId.", false);
  if (!name) return sendError(res, 400, "Missing name.", false);

  let match;
  try {
    match = await repo.findMember(name);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
  if (!match) {
    return sendJson(
      res,
      404,
      {
        ok: false,
        error: "not_on_roster",
        message: `"${name}" isn't on the roster. Ask a mentor to add it to data/roster.csv, or check the spelling.`,
      },
      false
    );
  }

  try {
    await repo.linkMember(discordId, match.name, subteam);
  } catch (err) {
    if (err.code === "23505") {
      return sendJson(
        res,
        409,
        {
          ok: false,
          error: "discord_already_linked",
          message:
            "That Discord account is already linked to another member. Ask a mentor to unlink it first.",
        },
        false
      );
    }
    throw err;
  }
  pushSheetStatus();
  return sendJson(
    res,
    200,
    { ok: true, name: match.name, subteam: subteam || match.subteam || "" },
    false
  );
}

async function handleGetLink(req, res, discordId) {
  if (!requireBot(req, res)) return;
  const member = await repo.getMemberByDiscordId(discordId);
  return sendJson(
    res,
    200,
    { ok: true, linked: Boolean(member), name: member ? member.name : null },
    false
  );
}

async function handleSignIn(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }

  const discordId = String(body.discordId || "").trim();
  const code = String(body.code || "").trim();
  if (!discordId) return sendError(res, 400, "Missing discordId.", false);
  if (!/^\d{4}$/.test(code)) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error: "invalid_format",
        message:
          "That's not a 4-digit team number — check the big number on the display site and try again.",
      },
      false
    );
  }

  const member = await repo.getMemberByDiscordId(discordId);
  const linkedName = member ? member.name : null;
  if (!linkedName) {
    return sendJson(
      res,
      409,
      {
        ok: false,
        error: "not_linked",
        message: "You're not linked yet. Run `/link <your roster name>` once first.",
      },
      false
    );
  }

  if (!codes.current()) {
    return sendJson(
      res,
      503,
      {
        ok: false,
        error: "code_unavailable",
        message:
          "Sign-ins aren't open yet — the display hasn't picked a team code. Try again in a minute.",
      },
      false
    );
  }

  if (!codes.isValid(code)) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error: "invalid_code",
        message:
          "That's not the current team number — the display changes every 60 seconds, so re-read it and try again.",
      },
      false
    );
  }

  const result = await repo.signIn(linkedName, code, "discord", { test: Boolean(body.test) });
  if (!result || result.ok !== true) {
    if (result && result.already) {
      return sendJson(
        res,
        409,
        {
          ok: false,
          already: true,
          error: "already_signed_in",
          message: "You're already signed in for today.",
        },
        false
      );
    }
    return sendJson(
      res,
      500,
      {
        ok: false,
        error: "signin_failed",
        message: `Sign-in failed: ${(result && result.error) || "unknown error — ask a mentor."}`,
      },
      false
    );
  }

  return sendJson(res, 200, { ok: true, name: result.name || linkedName }, false);
}

async function handleMentorSyncRoster(req, res) {
  if (!requireBot(req, res)) return;
  const result = await sheetSync.syncRoster();
  if (!result.ok) {
    return sendJson(res, 502, { ok: false, error: result.error }, false);
  }
  return sendJson(res, 200, result, false);
}

async function handleMentorResetPin(req, res) {
  if (!requireBot(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message, false);
  }
  const name = String(body.name || "").trim();
  if (!name) return sendError(res, 400, "Select a member.", false);

  let match;
  try {
    match = await repo.findMember(name);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
  if (!match) {
    return sendJson(
      res,
      404,
      { ok: false, error: "not_on_roster", message: "That name isn't on the roster." },
      false
    );
  }
  await repo.resetPin(match.name);
  pushSheetStatus();
  return sendJson(res, 200, { ok: true, name: match.name }, false);
}

async function handleExport(req, res) {
  if (!requireBot(req, res)) return;
  const url = new URL(req.url, "http://localhost");
  const range = url.searchParams.get("range") || "last-meeting";
  if (!["last-meeting", "last-2-weeks", "all"].includes(range)) {
    return sendError(res, 400, "Invalid export range.", false);
  }

  try {
    const rows = await repo.attendanceForExport(range);
    const header = [
      "Practice Date",
      "First Name",
      "Last Name",
      "Subteam",
      "Sign In",
      "Sign Out",
      "Hours",
      "Source",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.practiceDate,
          row.firstName,
          row.lastName,
          row.subteam,
          row.signIn,
          row.signOut,
          row.hours,
          row.source,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    const csv = lines.join("\n") + "\n";
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="glitch-attendance-${range}.csv"`,
      "Cache-Control": "no-store",
    });
    res.end(csv);
  } catch (err) {
    return sendError(res, 500, err.message, false);
  }
}

async function handler(req, res) {
  let pathname = "";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (err) {
    return sendError(res, 400, "Bad request.", false);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && serveKiosk(req, res, pathname)) return;

  if (req.method === "GET" && pathname === "/api/kiosk/roster") {
    return handleKioskRoster(req, res);
  }

  if (req.method === "POST" && pathname === "/api/kiosk/signin") {
    return handleKioskSignIn(req, res);
  }

  if (req.method === "POST" && pathname === "/api/kiosk/set-pin") {
    return handleKioskSetPin(req, res);
  }

  if (req.method === "GET" && pathname === "/api/mentor/roster") {
    return handleMentorRoster(req, res);
  }

  if (req.method === "POST" && pathname === "/api/mentor/members") {
    return handleMentorAddMember(req, res);
  }

  if (req.method === "POST" && pathname === "/api/mentor/signin") {
    return handleMentorSignIn(req, res);
  }

  if (req.method === "POST" && pathname === "/api/mentor/reset-pin") {
    return handleMentorResetPin(req, res);
  }

  if (req.method === "POST" && pathname === "/api/mentor/sync-roster") {
    return handleMentorSyncRoster(req, res);
  }

  if (req.method === "GET" && pathname === "/api/attendance/today") {
    return handleAttendanceToday(req, res);
  }

  if (req.method === "GET" && pathname === "/api/stats") {
    return handleStats(req, res);
  }

  if (req.method === "GET" && pathname === "/api/export") {
    return handleExport(req, res);
  }

  if (req.method === "POST" && pathname === "/api/signout") {
    return handleSignOut(req, res);
  }

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, await buildState(), true);
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(
      res,
      200,
      {
        ok: true,
        uptime: Math.round(process.uptime()),
        codeReady: Boolean(codes.current()),
        sheets: sheetSync.status(),
      },
      true
    );
  }

  if (req.method === "POST" && pathname === "/api/link") {
    return handleLink(req, res);
  }

  const linkMatch = pathname.match(/^\/api\/link\/([^/]+)$/);
  if (req.method === "GET" && linkMatch) {
    return handleGetLink(req, res, decodeURIComponent(linkMatch[1]));
  }

  if (req.method === "POST" && pathname === "/api/signin") {
    return handleSignIn(req, res);
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Glitch attendance API is running. Display data: GET /api/state\n");
    return;
  }

  return sendError(res, 404, "Not found.", false);
}

function start() {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[server] unhandled request error:", err);
      if (!res.headersSent) sendError(res, 500, "Internal server error.", false);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      console.log(`[server] attendance API listening on ${host}:${port}`);
      resolve(server);
    });
  });
}

module.exports = { start, buildState };
