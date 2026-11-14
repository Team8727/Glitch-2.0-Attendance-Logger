"use strict";

require("./env").load();

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run deploy/install-postgres.sh first.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) {
  return pool.query(text, params);
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id BIGSERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      subteam TEXT NOT NULL DEFAULT '',
      discord_id TEXT UNIQUE,
      pin_salt TEXT,
      pin_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS members_name_unique
      ON members (lower(first_name), lower(last_name));

    CREATE TABLE IF NOT EXISTS attendance (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      practice_date DATE NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      UNIQUE (member_id, practice_date)
    );

    CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance (practice_date);
    CREATE INDEX IF NOT EXISTS attendance_ts_idx ON attendance (ts);
  `);
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, init, close };
