/**
 * Glitch 2.0 Attendance — Google Apps Script backend.
 *
 * Serves two JSONP actions to the static GitHub Pages site (site/):
 *
 *   GET ?action=list&callback=cb
 *       -> { ok:true, members:[ {name, subteam}, ... ] }
 *
 *   GET ?action=signin&member=NAME&code=CODE&callback=cb
 *       -> { ok:true, name } | { ok:false, already:true, error } | { ok:false, error }
 *
 * Reads the same spreadsheet the manual setup used:
 *   Roster       A=Name, C=Subteam (header row 1)
 *   Sign-ins     A=Timestamp, B=Name, C=Practice code  (appended by the app)
 *   Config       A=key, B=value, rows 2+ (see README for keys)
 *
 * Setup: set SHEET_ID, deploy as web app (Execute as: me, Who has access: Anyone),
 * and paste the /exec URL into site/config.js. See backend/README.md.
 */

var SHEET_ID = "REPLACE_WITH_YOUR_SPREADSHEET_ID";

var TAB_ROSTER = "Roster";
var TAB_SIGNINS = "Sign-ins";
var TAB_CONFIG = "Config";

var ROSTER_NAME_COL = 1; // A
var ROSTER_SUBTEAM_COL = 3; // C (optional, used only for dropdown labels)

var SIGNIN_TS_COL = 1; // A
var SIGNIN_NAME_COL = 2; // B
var SIGNIN_CODE_COL = 3; // C

var MAX_CODE_LENGTH = 24;

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || "").toLowerCase();
  var cb = String(p.callback || "").replace(/[^A-Za-z0-9_$]/g, "");

  var payload;
  try {
    if (action === "list") {
      payload = handleList_();
    } else if (action === "signin") {
      payload = handleSignIn_(String(p.member || ""), String(p.code || ""));
    } else {
      payload = { ok: false, error: "Unknown action." };
    }
  } catch (err) {
    payload = { ok: false, error: "Server error: " + err.message };
  }
  return jsonp_(payload, cb);
}

function jsonp_(payload, cb) {
  var text = JSON.stringify(payload);
  if (cb !== "") {
    return ContentService.createTextOutput(cb + "(" + text + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function handleList_() {
  var sheet = sheet_(TAB_ROSTER);
  var values = sheet.getDataRange().getValues();
  var members = [];
  for (var i = 1; i < values.length; i += 1) { // skip header row
    var name = String(values[i][ROSTER_NAME_COL - 1] || "").trim();
    if (name === "") continue;
    members.push({
      name: name,
      subteam: String(values[i][ROSTER_SUBTEAM_COL - 1] || "").trim()
    });
  }
  return { ok: true, members: members };
}

function handleSignIn_(memberName, code) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var roster = roster_();
    var canonical = "";
    Object.keys(roster).forEach(function (n) {
      if (n.toLowerCase() === memberName.trim().toLowerCase()) canonical = n;
    });
    if (canonical === "") {
      return { ok: false, error: "Your name isn't on the roster — ask a mentor to add it." };
    }
    memberName = canonical;

    if (passcodeRequired_() && !passcodeMatches_(code)) {
      return { ok: false, error: "That's not today's code. Check the code box at the shop or ask a mentor." };
    }

    var sheet = sheet_(TAB_SIGNINS);
    var existing = sheet.getDataRange().getValues();
    var today = dateTag_(new Date());
    for (var i = 1; i < existing.length; i += 1) {
      var ts = existing[i][SIGNIN_TS_COL - 1];
      if (!(ts instanceof Date)) continue;
      var member = String(existing[i][SIGNIN_NAME_COL - 1] || "").toLowerCase();
      if (member === memberName.toLowerCase() && dateTag_(ts) === today) {
        return { ok: false, already: true, error: "You're already signed in for today." };
      }
    }

    sheet.appendRow([new Date(), memberName, code.slice(0, MAX_CODE_LENGTH)]);
    return { ok: true, name: memberName };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */

function sheet_(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function roster_() {
  var sheet = sheet_(TAB_ROSTER);
  var values = sheet.getDataRange().getValues();
  var roster = {};
  for (var i = 1; i < values.length; i += 1) {
    var name = String(values[i][ROSTER_NAME_COL - 1] || "").trim();
    if (name !== "") roster[name] = String(values[i][ROSTER_SUBTEAM_COL - 1] || "").trim();
  }
  return roster;
}

function configValue_(key, fallback) {
  var sheet = sheet_(TAB_CONFIG);
  if (!sheet) return fallback;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][0] || "").trim().toLowerCase() === key.toLowerCase()) {
      return String(values[i][1] || "").trim();
    }
  }
  return fallback;
}

function passcodeRequired_() {
  return String(configValue_("require_passcode", "TRUE")).toUpperCase() !== "FALSE";
}

function passcodeMatches_(code) {
  var stored = configValue_("passcode", "");
  if (stored === "") return false; // no code configured -> nobody can sign in
  if (String(code).toUpperCase() !== String(stored).toUpperCase()) return false;
  var expectedDate = configValue_("passcode_date", "");
  if (expectedDate !== "") {
    var actual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (expectedDate !== actual) return false;
  }
  return true;
}

function dateTag_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}