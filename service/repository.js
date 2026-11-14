"use strict";

const crypto = require("crypto");
const db = require("./db");

const KEY_LENGTH = 64;

function tz() {
  return process.env.TZ || "America/New_York";
}

function localDate(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: tz() });
}

function fullName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim();
}

function mapMember(row) {
  return {
    id: row.id,
    name: fullName(row),
    subteam: row.subteam || "",
    discordId: row.discord_id || null,
    hasPin: Boolean(row.has_pin),
  };
}

async function listMembers({ unlinkedOnly = false } = {}) {
  const where = unlinkedOnly ? "WHERE discord_id IS NULL" : "";
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, subteam, discord_id,
            (pin_hash IS NOT NULL) AS has_pin
       FROM members
       ${where}
      ORDER BY lower(first_name), lower(last_name)`
  );
  return rows.map(mapMember);
}

async function findMember(name) {
  const target = String(name || "").trim();
  if (!target) return null;
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, subteam, discord_id,
            (pin_hash IS NOT NULL) AS has_pin
       FROM members
      WHERE lower(first_name || ' ' || last_name) = lower($1)
      LIMIT 1`,
    [target]
  );
  return rows[0] ? mapMember(rows[0]) : null;
}

async function getMemberByDiscordId(discordId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, subteam, discord_id,
            (pin_hash IS NOT NULL) AS has_pin
       FROM members
      WHERE discord_id = $1
      LIMIT 1`,
    [String(discordId)]
  );
  return rows[0] ? mapMember(rows[0]) : null;
}

async function linkMember(discordId, name, subteam) {
  const member = await findMember(name);
  if (!member) return null;
  await db.query(
    `UPDATE members
        SET discord_id = $1,
            subteam = COALESCE(NULLIF($2, ''), subteam),
            updated_at = now()
      WHERE id = $3`,
    [String(discordId), String(subteam || "").trim(), member.id]
  );
  return findMember(name);
}

async function setSubteam(name, subteam) {
  await db.query(
    `UPDATE members
        SET subteam = $1, updated_at = now()
      WHERE lower(first_name || ' ' || last_name) = lower($2)`,
    [String(subteam || "").trim(), String(name || "").trim()]
  );
}

async function hasPin(name) {
  const { rows } = await db.query(
    `SELECT (pin_hash IS NOT NULL) AS has_pin
       FROM members
      WHERE lower(first_name || ' ' || last_name) = lower($1)
      LIMIT 1`,
    [String(name || "").trim()]
  );
  return Boolean(rows[0] && rows[0].has_pin);
}

async function setPin(name, pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pin), salt, KEY_LENGTH).toString("hex");
  await db.query(
    `UPDATE members
        SET pin_salt = $1, pin_hash = $2, updated_at = now()
      WHERE lower(first_name || ' ' || last_name) = lower($3)`,
    [salt, hash, String(name || "").trim()]
  );
}

async function verifyPin(name, pin) {
  const { rows } = await db.query(
    `SELECT pin_salt, pin_hash
       FROM members
      WHERE lower(first_name || ' ' || last_name) = lower($1)
      LIMIT 1`,
    [String(name || "").trim()]
  );
  const entry = rows[0];
  if (!entry || !entry.pin_salt || !entry.pin_hash) return false;
  const actual = crypto.scryptSync(String(pin), entry.pin_salt, KEY_LENGTH);
  const expected = Buffer.from(entry.pin_hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function resetPin(name) {
  await db.query(
    `UPDATE members
        SET pin_salt = NULL, pin_hash = NULL, updated_at = now()
      WHERE lower(first_name || ' ' || last_name) = lower($1)`,
    [String(name || "").trim()]
  );
}

async function signIn(name, code, source) {
  const member = await findMember(name);
  if (!member) return { ok: false, error: "not_on_roster" };
  const practiceDate = localDate();
  try {
    await db.query(
      `INSERT INTO attendance (member_id, ts, practice_date, source, code)
       VALUES ($1, now(), $2, $3, $4)`,
      [member.id, practiceDate, String(source || ""), String(code || "")]
    );
    return { ok: true, name: member.name };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, already: true, error: "already signed in" };
    }
    throw err;
  }
}

async function todayList() {
  const date = localDate();
  const { rows } = await db.query(
    `SELECT m.first_name, m.last_name,
            to_char(a.ts AT TIME ZONE $2, 'HH24:MI') AS at
       FROM attendance a
       JOIN members m ON m.id = a.member_id
      WHERE a.practice_date = $1
      ORDER BY a.ts`,
    [date, tz()]
  );
  return {
    date,
    count: rows.length,
    members: rows.map((row) => ({ name: fullName(row), at: row.at })),
  };
}

async function seasonStats() {
  const [members, practices, signins] = await Promise.all([
    db.query(
      `SELECT m.first_name, m.last_name, count(*)::int AS count
         FROM attendance a
         JOIN members m ON m.id = a.member_id
        GROUP BY m.id, m.first_name, m.last_name
        ORDER BY count DESC, lower(m.first_name), lower(m.last_name)`
    ),
    db.query(`SELECT count(DISTINCT practice_date)::int AS count FROM attendance`),
    db.query(`SELECT count(*)::int AS count FROM attendance`),
  ]);
  return {
    practices: practices.rows[0].count,
    signins: signins.rows[0].count,
    members: members.rows.map((row) => ({ name: fullName(row), count: row.count })),
  };
}

async function allAttendance() {
  const { rows } = await db.query(
    `SELECT a.ts, m.first_name, m.last_name, a.code, a.source
       FROM attendance a
       JOIN members m ON m.id = a.member_id
      ORDER BY a.ts`
  );
  return rows.map((row) => ({
    ts: row.ts.toISOString(),
    name: fullName(row),
    code: row.code || "",
    source: row.source || "",
  }));
}

async function memberStatusRows() {
  const { rows } = await db.query(
    `SELECT first_name, last_name, subteam, discord_id,
            (pin_hash IS NOT NULL) AS has_pin
       FROM members
      ORDER BY lower(first_name), lower(last_name)`
  );
  return rows.map((row) => ({
    name: fullName(row),
    subteam: row.subteam || "",
    hasPin: Boolean(row.has_pin),
    discordId: row.discord_id || "",
  }));
}

module.exports = {
  listMembers,
  findMember,
  getMemberByDiscordId,
  linkMember,
  setSubteam,
  hasPin,
  setPin,
  verifyPin,
  resetPin,
  signIn,
  todayList,
  seasonStats,
  allAttendance,
  memberStatusRows,
  localDate,
};
