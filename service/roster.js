"use strict";

/*
 * Roster reader — data/roster.csv at the repo root (override with ROSTER_CSV).
 * Columns: Name, Student ID, Subteam, Role, Email. Only Name and Subteam are
 * used; everything else is ignored.
 *
 * The file is re-read on every /link, so roster edits need no bot restart.
 * Names match case-insensitively and are canonicalized to the CSV's casing.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "roster.csv");
const DEFAULT_SHEET_FILE = path.join(__dirname, "data", "roster-sheet.json");

function rosterFile() {
  return process.env.ROSTER_CSV || DEFAULT_FILE;
}

function parseRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line.split(",").map((cell) => {
        const trimmed = cell.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1).trim();
        }
        return trimmed;
      })
    );
}

function load() {
  const sheetFile = process.env.ROSTER_JSON || DEFAULT_SHEET_FILE;
  try {
    const data = JSON.parse(fs.readFileSync(sheetFile, "utf8"));
    if (Array.isArray(data) && data.length > 0) {
      const members = [];
      const seen = new Set();
      for (const row of data) {
        const name = String((row && row.name) || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) {
          console.warn(`[roster] duplicate name skipped: ${name}`);
          continue;
        }
        seen.add(key);
        members.push({
          name,
          subteam: String((row && row.subteam) || "").trim(),
          studentId: String((row && row.studentId) || "").trim(),
          role: String((row && row.role) || "").trim(),
          email: String((row && row.email) || "").trim(),
        });
      }
      if (members.length > 0) return members;
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[roster] could not read sheet roster cache:", err.message);
    }
  }

  const file = rosterFile();
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("The roster file is missing — a mentor needs to add data/roster.csv.");
    }
    throw new Error("The roster file could not be read — ask a mentor.");
  }

  const rows = parseRows(text);
  const header = rows.length > 0 ? rows[0].map((cell) => cell.toLowerCase()) : [];
  const nameCol = header.indexOf("name");
  const subteamCol = nameCol === -1 ? -1 : header.indexOf("subteam");
  const firstRow = nameCol === -1 ? 0 : 1;
  const nameIndex = nameCol === -1 ? 0 : nameCol;

  const members = [];
  const seen = new Set();
  for (let i = firstRow; i < rows.length; i += 1) {
    const name = (rows[i][nameIndex] || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      console.warn(`[roster] duplicate name skipped: ${name}`);
      continue;
    }
    seen.add(key);
    members.push({
      name,
      subteam: subteamCol === -1 ? "" : (rows[i][subteamCol] || "").trim(),
    });
  }
  return members;
}

function find(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  return load().find((member) => member.name.toLowerCase() === target) || null;
}

module.exports = { load, find };
