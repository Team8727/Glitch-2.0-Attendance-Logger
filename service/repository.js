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

async function addMember(firstName, lastName, subteam) {
  const { rows } = await db.query(
    `INSERT INTO members (first_name, last_name, subteam)
     VALUES ($1, $2, $3)
     RETURNING id, first_name, last_name, subteam, discord_id,
               (pin_hash IS NOT NULL) AS has_pin`,
    [String(firstName || "").trim(), String(lastName || "").trim(), String(subteam || "").trim()]
  );
  return mapMember(rows[0]);
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

async function signIn(name, code, source, { test = false } = {}) {
  const member = await findMember(name);
  if (!member) return { ok: false, error: "not_on_roster" };
  const practiceDate = localDate();

  const existing = await db.query(
    `SELECT id, left_at FROM attendance
      WHERE member_id = $1 AND practice_date = $2
      LIMIT 1`,
    [member.id, practiceDate]
  );
  if (existing.rowCount > 0) {
    if (existing.rows[0].left_at) {
      await db.query(
        `UPDATE attendance
            SET ts = now(), left_at = NULL, source = $1, code = $2, is_test = $3
          WHERE id = $4`,
        [String(source || ""), String(code || ""), Boolean(test), existing.rows[0].id]
      );
      return { ok: true, name: member.name, rejoined: true };
    }
    return { ok: false, already: true, error: "already signed in" };
  }

  try {
    await db.query(
      `INSERT INTO attendance (member_id, ts, practice_date, source, code, is_test)
       VALUES ($1, now(), $2, $3, $4, $5)`,
      [member.id, practiceDate, String(source || ""), String(code || ""), Boolean(test)]
    );
    return { ok: true, name: member.name };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, already: true, error: "already signed in" };
    }
    throw err;
  }
}

async function signOut(name) {
  const member = await findMember(name);
  if (!member) return { ok: false, error: "not_on_roster" };
  const practiceDate = localDate();
  const { rows } = await db.query(
    `SELECT id, ts, left_at FROM attendance
      WHERE member_id = $1 AND practice_date = $2
      LIMIT 1`,
    [member.id, practiceDate]
  );
  if (rows.length === 0) return { ok: false, error: "not_signed_in" };
  if (rows[0].left_at) return { ok: false, already: true, error: "already signed out" };

  await db.query(`UPDATE attendance SET left_at = now() WHERE id = $1`, [rows[0].id]);
  const durationMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(rows[0].ts).getTime()) / 60000)
  );
  return { ok: true, name: member.name, durationMinutes };
}

async function todayList() {
  const date = localDate();
  const { rows } = await db.query(
    `SELECT m.first_name, m.last_name, m.subteam, a.ts, a.left_at, a.is_test,
            to_char(a.ts AT TIME ZONE $2, 'HH24:MI') AS at,
            to_char(a.left_at AT TIME ZONE $2, 'HH24:MI') AS left_at_time
       FROM attendance a
       JOIN members m ON m.id = a.member_id
      WHERE a.practice_date = $1
      ORDER BY a.ts`,
    [date, tz()]
  );
  return {
    date,
    count: rows.length,
    members: rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      at: row.at,
      ts: row.ts.toISOString(),
      leftAt: row.left_at ? row.left_at.toISOString() : null,
      leftAtTime: row.left_at_time || null,
      isTest: Boolean(row.is_test),
    })),
  };
}

async function seasonStats() {
  const [members, practices, signins] = await Promise.all([
    db.query(
      `SELECT m.first_name, m.last_name, count(*)::int AS count
         FROM attendance a
         JOIN members m ON m.id = a.member_id
        WHERE a.is_test = false
        GROUP BY m.id, m.first_name, m.last_name
        ORDER BY count DESC, lower(m.first_name), lower(m.last_name)`
    ),
    db.query(`SELECT count(DISTINCT practice_date)::int AS count FROM attendance WHERE is_test = false`),
    db.query(`SELECT count(*)::int AS count FROM attendance WHERE is_test = false`),
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
      WHERE a.is_test = false
      ORDER BY a.ts`
  );
  return rows.map((row) => ({
    ts: row.ts.toISOString(),
    name: fullName(row),
    code: row.code || "",
    source: row.source || "",
  }));
}

async function attendanceForExport(range) {
  let where = "a.is_test = false";
  if (range === "last-meeting") {
    where +=
      " AND a.practice_date = (SELECT MAX(practice_date) FROM attendance WHERE is_test = false)";
  } else if (range === "last-2-weeks") {
    where += " AND a.practice_date >= CURRENT_DATE - interval '14 days'";
  }

  const { rows } = await db.query(
    `SELECT to_char(a.practice_date, 'YYYY-MM-DD') AS practice_date,
            m.first_name, m.last_name, m.subteam,
            to_char(a.ts AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS sign_in,
            to_char(a.left_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS sign_out,
            ROUND(
              GREATEST(
                0,
                EXTRACT(EPOCH FROM (
                  LEAST(COALESCE(a.left_at, now()), a.ts + interval '2 hours') - a.ts
                )) / 3600.0
              )::numeric,
              2
            ) AS hours,
            a.source
       FROM attendance a
       JOIN members m ON m.id = a.member_id
      WHERE ${where}
      ORDER BY a.practice_date, a.ts`,
    [tz()]
  );

  return rows.map((row) => ({
    practiceDate: row.practice_date,
    firstName: row.first_name,
    lastName: row.last_name,
    name: fullName(row),
    subteam: row.subteam || "",
    signIn: row.sign_in || "",
    signOut: row.sign_out || "",
    hours: Number(row.hours),
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
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    subteam: row.subteam || "",
    hasPin: Boolean(row.has_pin),
    discordId: row.discord_id || "",
  }));
}

async function stats() {
  const tzValue = tz();
  const sessionsCte = `
    WITH sessions AS (
      SELECT a.id, a.member_id, a.practice_date, a.ts, a.left_at, a.source,
             m.first_name, m.last_name, m.subteam,
             GREATEST(
               0,
               EXTRACT(EPOCH FROM (
                 LEAST(COALESCE(a.left_at, now()), a.ts + interval '2 hours') - a.ts
               )) / 3600.0
             ) AS hours,
             EXTRACT(EPOCH FROM (
               a.ts - ((a.practice_date + time '15:30') AT TIME ZONE $1)
             )) / 60.0 AS minutes_after_start,
             CASE
               WHEN a.left_at IS NULL THEN NULL
               ELSE EXTRACT(EPOCH FROM (
                 a.left_at - ((a.practice_date + time '17:30') AT TIME ZONE $1)
               )) / 60.0
             END AS minutes_after_end
        FROM attendance a
        JOIN members m ON m.id = a.member_id
       WHERE a.is_test = false
    )
  `;
  const q = (sql) => db.query(`${sessionsCte} ${sql}`, [tzValue]);

  const [
    totals,
    subteams,
    members,
    byWeekday,
    byPractice,
    sourceBreakdown,
    sessionBuckets,
    signInBuckets,
    signOutBuckets,
    consistency,
    forgotSignOut,
    punctuality,
    longestSessions,
    streakRows,
  ] = await Promise.all([
    q(`SELECT COALESCE(SUM(hours), 0)::float AS hours,
              COUNT(*)::int AS sessions,
              COUNT(DISTINCT practice_date)::int AS practices,
              COUNT(DISTINCT member_id)::int AS members
         FROM sessions`),
    q(`SELECT COALESCE(NULLIF(subteam, ''), 'Unknown') AS subteam,
              SUM(hours)::float AS hours,
              COUNT(*)::int AS sessions,
              COUNT(DISTINCT member_id)::int AS members
         FROM sessions
        GROUP BY 1
        ORDER BY hours DESC`),
    q(`SELECT first_name, last_name, subteam,
              SUM(hours)::float AS hours,
              COUNT(*)::int AS sessions
         FROM sessions
        GROUP BY member_id, first_name, last_name, subteam
        ORDER BY hours DESC, lower(first_name), lower(last_name)`),
    q(`SELECT EXTRACT(ISODOW FROM practice_date)::int AS weekday_num,
              to_char(practice_date, 'Dy') AS weekday,
              COUNT(*)::int AS sessions,
              SUM(hours)::float AS hours
         FROM sessions
        GROUP BY 1, 2
        ORDER BY 1`),
    q(`SELECT to_char(practice_date, 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS sessions,
              SUM(hours)::float AS hours
         FROM sessions
        GROUP BY 1
        ORDER BY 1`),
    q(`SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source,
              COUNT(*)::int AS sessions
         FROM sessions
        GROUP BY 1
        ORDER BY sessions DESC`),
    q(`SELECT CASE
                WHEN hours < 0.5 THEN 'Under 30 min'
                WHEN hours < 1 THEN '30–60 min'
                WHEN hours < 1.5 THEN '1–1.5 hr'
                WHEN hours < 2 THEN '1.5–2 hr'
                ELSE '2+ hr'
              END AS bucket,
              COUNT(*)::int AS sessions
         FROM sessions
        GROUP BY 1
        ORDER BY 1`),
    q(`SELECT CASE
                WHEN minutes_after_start < 0 THEN 'Before 3:30'
                WHEN minutes_after_start < 15 THEN '3:30–3:45'
                WHEN minutes_after_start < 30 THEN '3:45–4:00'
                WHEN minutes_after_start < 60 THEN '4:00–4:30'
                ELSE 'After 4:30'
              END AS bucket,
              COUNT(*)::int AS sessions
         FROM sessions
        GROUP BY 1
        ORDER BY 1`),
    q(`SELECT CASE
                WHEN left_at IS NULL THEN 'Never signed out'
                WHEN minutes_after_end < -30 THEN 'Before 5:00'
                WHEN minutes_after_end < 0 THEN '5:00–5:30'
                WHEN minutes_after_end < 30 THEN '5:30–6:00'
                ELSE 'After 6:00'
              END AS bucket,
              COUNT(*)::int AS sessions
         FROM sessions
        GROUP BY 1
        ORDER BY 1`),
    q(`SELECT m.first_name, m.last_name, m.subteam,
              COUNT(DISTINCT s.practice_date)::int AS attended
         FROM members m
         LEFT JOIN sessions s ON s.member_id = m.id
        GROUP BY m.id, m.first_name, m.last_name, m.subteam
        ORDER BY attended DESC, lower(m.first_name), lower(m.last_name)`),
    q(`SELECT first_name, last_name, subteam, COUNT(*)::int AS count
         FROM sessions
        WHERE left_at IS NULL
        GROUP BY first_name, last_name, subteam
        ORDER BY count DESC, lower(first_name), lower(last_name)`),
    q(`SELECT first_name, last_name, subteam, AVG(minutes_after_start)::float AS avg_minutes
         FROM sessions
        GROUP BY first_name, last_name, subteam
        ORDER BY avg_minutes ASC`),
    q(`SELECT first_name, last_name, subteam,
              to_char(practice_date, 'YYYY-MM-DD') AS date,
              hours
         FROM sessions
        ORDER BY hours DESC
        LIMIT 10`),
    q(`SELECT member_id, first_name, last_name, subteam,
              to_char(practice_date, 'YYYY-MM-DD') AS date
         FROM sessions
        ORDER BY practice_date, member_id`),
  ]);

  const practiceDates = byPractice.rows.map((row) => row.date);
  const meetings = practiceDates.length;
  const attendedByMember = new Map();
  for (const row of streakRows.rows) {
    if (!attendedByMember.has(row.member_id)) {
      attendedByMember.set(row.member_id, {
        name: fullName(row),
        subteam: row.subteam || "",
        dates: new Set(),
      });
    }
    attendedByMember.get(row.member_id).dates.add(row.date);
  }

  const streaks = [];
  for (const entry of attendedByMember.values()) {
    let longest = 0;
    let run = 0;
    for (const date of practiceDates) {
      if (entry.dates.has(date)) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    let current = 0;
    for (let i = practiceDates.length - 1; i >= 0; i -= 1) {
      if (entry.dates.has(practiceDates[i])) current += 1;
      else break;
    }
    streaks.push({
      name: entry.name,
      subteam: entry.subteam,
      longest,
      current,
    });
  }
  streaks.sort(
    (a, b) => b.longest - a.longest || b.current - a.current || a.name.localeCompare(b.name)
  );

  return {
    totals: totals.rows[0],
    subteams: subteams.rows.map((row) => ({
      subteam: row.subteam,
      hours: Number(row.hours),
      sessions: row.sessions,
      members: row.members,
    })),
    members: members.rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      hours: Number(row.hours),
      sessions: row.sessions,
    })),
    byWeekday: byWeekday.rows.map((row) => ({
      weekday: row.weekday,
      weekdayNum: row.weekday_num,
      sessions: row.sessions,
      hours: Number(row.hours),
    })),
    byPractice: byPractice.rows.map((row) => ({
      date: row.date,
      sessions: row.sessions,
      hours: Number(row.hours),
    })),
    sourceBreakdown: sourceBreakdown.rows,
    sessionBuckets: sessionBuckets.rows,
    signInBuckets: signInBuckets.rows,
    signOutBuckets: signOutBuckets.rows,
    consistency: consistency.rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      attended: row.attended,
      meetings,
      rate: meetings ? row.attended / meetings : 0,
    })),
    forgotSignOut: forgotSignOut.rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      count: row.count,
    })),
    punctuality: punctuality.rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      avgMinutes: Number(row.avg_minutes),
    })),
    longestSessions: longestSessions.rows.map((row) => ({
      name: fullName(row),
      subteam: row.subteam || "",
      date: row.date,
      hours: Number(row.hours),
    })),
    streaks: streaks.slice(0, 10),
  };
}

module.exports = {
  listMembers,
  addMember,
  findMember,
  getMemberByDiscordId,
  linkMember,
  setSubteam,
  hasPin,
  setPin,
  verifyPin,
  resetPin,
  signIn,
  signOut,
  todayList,
  seasonStats,
  allAttendance,
  memberStatusRows,
  attendanceForExport,
  stats,
  localDate,
};
