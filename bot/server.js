"use strict";

/*
 * HTTP API for the display site — Node's built-in http, no dependencies.
 *
 *   GET /api/state -> 200 JSON (see docs/SETUP.md for the full shape), with
 *   Access-Control-Allow-Origin: * so GitHub Pages can fetch it cross-origin.
 *
 * secondsRemaining is computed per request (never cached) from the current
 * window, so the site's countdown is always derived from fresh data.
 */

const http = require("http");

const codes = require("./codes");
const attendance = require("./attendance");
const tba = require("./tba");

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function buildState() {
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
    today: attendance.todayList(),
    season: attendance.seasonStats(),
  };
}

function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  let pathname = "";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: "Bad request." });
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, buildState());
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Glitch attendance API is running. Display data: GET /api/state\n");
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

function start() {
  const port = Number(process.env.PORT) || 3000;
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      console.log(`[server] display API listening on port ${port}`);
      resolve(server);
    });
  });
}

module.exports = { start, buildState };
