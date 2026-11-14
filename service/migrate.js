"use strict";

require("./env").load();

const fs = require("fs");
const path = require("path");
const db = require("./db");

const DATA_DIR = path.join(__dirname, "data");
const ROSTER_CSV = path.join(__dirname, "..", "data", "roster.csv");
const ROSTER_JSON = path.join(DATA_DIR, "roster-sheet.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`[migrate] could not read ${file}:`, err.message);
    return fallback;
  }
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function parseCsv(text) {
  const rows = text
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
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const nameCol = header.indexOf("name");
  const subteamCol = header.indexOf("subteam");
  const firstRow = nameCol === -1 ? 0 : 1;
  const nameIndex = nameCol === -1 ? 0 : nameCol;
  const out = [];
  for (let i = firstRow; i < rows.length; i += 1) {
    const name = (rows[i][nameIndex] || "").trim();
    if (!name) continue;
    out.push({
      name,
      subteam: subteamCol === -1 ? "" : (rows[i][subteamCol] || "").trim(),
    });
  }
  return out;
}

function loadRoster() {
  const sheet = readJson(ROSTER_JSON, []);
  if (Array.isArray(sheet) && sheet.length > 0) {
    return sheet
      .map((row) => ({
        name: String((row && row.name) || "").trim(),
        subteam: String((row && row.subteam) || "").trim(),
      }))
      .filter((row) => row.name);
  }
  try {
    return parseCsv(fs.readFileSync(ROSTER_CSV, "utf8"));
  } catch (err) {
    console.error("[migrate] could not read roster CSV:", err.message);
    return [];
  }
}

async function upsertMember(name, subteam) {
  const parts = splitName(name);
  if (!parts) return null;
  const existing = await db.query(
    `SELECT id FROM members
      WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2)
      LIMIT 1`,
    [parts.first, parts.last]
  );
  if (existing.rowCount > 0) {
    if (subteam) {
      await db.query(
        `UPDATE members SET subteam = $1, updated_at = now() WHERE id = $2`,
        [subteam, existing.rows[0].id]
      );
    }
    return existing.rows[0].id;
  }
  const inserted = await db.query(
    `INSERT INTO members (first_name, last_name, subteam)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [parts.first, parts.last, subteam || ""]
  );
  return inserted.rows[0].id;
}

async function findMemberId(name) {
  const parts = splitName(name);
  if (!parts) return null;
  const { rows } = await db.query(
    `SELECT id FROM members
      WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2)
      LIMIT 1`,
    [parts.first, parts.last]
  );
  return rows[0] ? rows[0].id : null;
}

async function main() {
  await db.init();

  const roster = loadRoster();
  let members = 0;
  for (const row of roster) {
    const id = await upsertMember(row.name, row.subteam);
    if (id) members += 1;
  }
  console.log(`[migrate] members: ${members}`);

  const links = readJson(path.join(DATA_DIR, "links.json"), {});
  let linked = 0;
  for (const [discordId, name] of Object.entries(links)) {
    const id = await findMemberId(name);
    if (!id) {
      console.warn(`[migrate] link target not found: ${name}`);
      continue;
    }
    try {
      await db.query(
        `UPDATE members SET discord_id = $1, updated_at = now() WHERE id = $2`,
        [String(discordId), id]
      );
      linked += 1;
    } catch (err) {
      console.warn(`[migrate] could not link ${name}: ${err.message}`);
    }
  }
  console.log(`[migrate] discord links: ${linked}`);

  const pins = readJson(path.join(DATA_DIR, "pins.json"), {});
  let pinCount = 0;
  for (const [name, entry] of Object.entries(pins)) {
    const id = await findMemberId(name);
    if (!id || !entry || !entry.salt || !entry.hash) continue;
    await db.query(
      `UPDATE members SET pin_salt = $1, pin_hash = $2, updated_at = now() WHERE id = $3`,
      [entry.salt, entry.hash, id]
    );
    pinCount += 1;
  }
  console.log(`[migrate] PINs: ${pinCount}`);

  const subteams = readJson(path.join(DATA_DIR, "subteams.json"), {});
  let subteamCount = 0;
  for (const [name, subteam] of Object.entries(subteams)) {
    const id = await findMemberId(name);
    if (!id || !subteam) continue;
    await db.query(
      `UPDATE members SET subteam = $1, updated_at = now() WHERE id = $2`,
      [String(subteam), id]
    );
    subteamCount += 1;
  }
  console.log(`[migrate] subteams: ${subteamCount}`);

  const signins = readJson(path.join(DATA_DIR, "signins.json"), []);
  const tz = process.env.TZ || "America/New_York";
  let attendance = 0;
  for (const row of Array.isArray(signins) ? signins : []) {
    const id = await findMemberId(row.name);
    if (!id) {
      console.warn(`[migrate] attendance member not found: ${row.name}`);
      continue;
    }
    const date = new Date(row.ts);
    if (Number.isNaN(date.getTime())) continue;
    const practiceDate = date.toLocaleDateString("en-CA", { timeZone: tz });
    const result = await db.query(
      `INSERT INTO attendance (member_id, ts, practice_date, source, code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, practice_date) DO NOTHING`,
      [id, date.toISOString(), practiceDate, row.source || "", row.code || ""]
    );
    attendance += result.rowCount;
  }
  console.log(`[migrate] attendance rows inserted: ${attendance}`);

  await db.close();
}

main().catch(async (err) => {
  console.error("[migrate] failed:", err);
  await db.close().catch(() => {});
  process.exit(1);
});
