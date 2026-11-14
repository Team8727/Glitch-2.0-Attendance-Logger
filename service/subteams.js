"use strict";

/*
 * Member-selected subteams. Stored separately so a member can set/update their
 * subteam from Discord /link or the kiosk PIN setup. The sheet sync writes the
 * merged value back to the Roster tab.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "data", "subteams.json");
let queue = Promise.resolve();

function storeFile() {
  return process.env.SUBTEAMS_FILE || DEFAULT_FILE;
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[subteams] could not read subteams:", err.message);
    }
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    const tmp = storeFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, storeFile());
  } catch (err) {
    console.error("[subteams] could not save subteams:", err.message);
  }
}

function key(name) {
  return String(name || "").trim().toLowerCase();
}

function get(name) {
  return load()[key(name)] || "";
}

function set(name, subteam) {
  const run = queue.then(() => {
    const data = load();
    data[key(name)] = String(subteam || "").trim();
    save(data);
    return data[key(name)];
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { get, set, load };
