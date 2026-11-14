"use strict";

/*
 * Per-member kiosk PINs. Stored as scrypt hashes with a random salt in
 * service/data/pins.json. Plaintext PINs are never written to disk.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_FILE = path.join(__dirname, "data", "pins.json");
const KEY_LENGTH = 64;

let queue = Promise.resolve();

function pinsFile() {
  return process.env.PINS_FILE || DEFAULT_FILE;
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(pinsFile(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[pins] could not read pins:", err.message);
    }
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(pinsFile()), { recursive: true });
    const tmp = pinsFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, pinsFile());
  } catch (err) {
    console.error("[pins] could not save pins:", err.message);
  }
}

function mutate(fn) {
  const run = queue.then(() => {
    const data = load();
    const result = fn(data);
    save(data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function key(name) {
  return String(name || "").trim().toLowerCase();
}

function has(name) {
  return Boolean(load()[key(name)]);
}

function set(name, pin) {
  return mutate((data) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(pin), salt, KEY_LENGTH).toString("hex");
    data[key(name)] = { salt, hash, createdAt: new Date().toISOString() };
    return true;
  });
}

function verify(name, pin) {
  const entry = load()[key(name)];
  if (!entry || !entry.salt || !entry.hash) return false;
  const actual = crypto.scryptSync(String(pin), entry.salt, KEY_LENGTH);
  const expected = Buffer.from(entry.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function remove(name) {
  return mutate((data) => {
    delete data[key(name)];
    return true;
  });
}

module.exports = { has, set, verify, remove };
