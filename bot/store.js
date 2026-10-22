"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "data", "links.json");

let queue = Promise.resolve();

function storeFile() {
  return process.env.LINKS_FILE || DEFAULT_FILE;
}

function load() {
  try {
    const raw = fs.readFileSync(storeFile(), "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[store] could not read links file:", err.message);
    }
    return {};
  }
}

function save(data) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
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

function get(userId) {
  return load()[String(userId)] || null;
}

function set(userId, name) {
  return mutate((data) => {
    data[String(userId)] = name;
    return name;
  });
}

function all() {
  return load();
}

module.exports = { get, set, all };
