/**
 * Glitch 2.0 attendance → Google Sheets webhook.
 *
 * Tabs:
 *   Sign-ins — appended by the attendance service
 *   Roster   — source of truth for First Name / Last Name; Subteam and status
 *              columns are written back by the service.
 *
 * Setup:
 *   1. Create a Google Sheet.
 *   2. Extensions → Apps Script, paste this file.
 *   3. Set SHEET_ID and SECRET below.
 *   4. Deploy → New deployment → Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 *   5. Copy the web app URL into service/.env as SHEETS_WEBHOOK_URL.
 *   6. Restart the attendance service.
 */

const SHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE';
const SIGNINS_TAB = 'Sign-ins';
const ROSTER_TAB = 'Roster';
const SECRET = 'PASTE_SHEETS_WEBHOOK_SECRET_HERE';

const ROSTER_HEADERS = [
  'First Name',
  'Last Name',
  'Subteam',
  'PIN Set',
  'Discord Linked',
  'Discord ID',
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }
    const action = body.action || 'syncSignins';
    if (action === 'getRoster') return getRoster();
    if (action === 'updateRosterStatus') return updateRosterStatus(body.rows || []);
    return syncSignins(body.rows || []);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'glitch-attendance-sheets' });
}

/* ---------- sign-ins ---------- */

function syncSignins(rows) {
  if (rows.length === 0) return json({ ok: true, appended: 0 });

  const sheet = getSigninsSheet();
  const existing = existingSigninKeys(sheet);
  const fresh = rows.filter((row) => {
    const key = `${new Date(row.ts).toISOString()}|${row.name}`;
    return !existing.has(key);
  });

  if (fresh.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    const values = fresh.map((row) => [
      new Date(row.ts),
      row.name,
      row.code || '',
      row.source || '',
    ]);
    sheet.getRange(startRow, 1, values.length, 4).setValues(values);
    sheet.getRange(startRow, 1, values.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  return json({ ok: true, appended: fresh.length });
}

function getSigninsSheet() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  let sheet = spreadsheet.getSheetByName(SIGNINS_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(SIGNINS_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Name', 'Code', 'Source']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function existingSigninKeys(sheet) {
  const keys = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (const row of values) {
    if (!row[0] || !row[1]) continue;
    keys.add(`${new Date(row[0]).toISOString()}|${row[1]}`);
  }
  return keys;
}

/* ---------- roster ---------- */

function getRoster() {
  const sheet = getRosterSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return json({ ok: true, roster: [] });

  const values = sheet.getRange(2, 1, lastRow - 1, ROSTER_HEADERS.length).getValues();
  const roster = values
    .map((row) => {
      const firstName = String(row[0] || '').trim();
      const lastName = String(row[1] || '').trim();
      return {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim(),
        subteam: String(row[2] || '').trim(),
      };
    })
    .filter((row) => row.name);
  return json({ ok: true, roster });
}

function updateRosterStatus(rows) {
  const sheet = getRosterSheet();
  const lastRow = sheet.getLastRow();
  const values =
    lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, ROSTER_HEADERS.length).getValues()
      : [];

  const byName = new Map();
  for (let i = 0; i < values.length; i += 1) {
    const name = `${String(values[i][0] || '').trim()} ${String(values[i][1] || '').trim()}`.trim();
    if (name) byName.set(name.toLowerCase(), i);
  }

  let updated = 0;
  let appended = 0;
  for (const status of rows) {
    if (!status || !status.name) continue;
    const key = String(status.name).trim().toLowerCase();
    const parts = String(status.name).trim().split(/\s+/);
    const firstName = status.firstName || parts[0] || '';
    const lastName = status.lastName || parts.slice(1).join(' ') || '';
    const row = [
      firstName,
      lastName,
      status.subteam || '',
      status.hasPin ? 'Yes' : 'No',
      status.discordId ? 'Yes' : 'No',
      status.discordId || '',
    ];
    if (byName.has(key)) {
      values[byName.get(key)] = row;
      updated += 1;
    } else {
      values.push(row);
      byName.set(key, values.length - 1);
      appended += 1;
    }
  }

  if (values.length > 0) {
    sheet.getRange(2, 1, values.length, ROSTER_HEADERS.length).setValues(values);
  }
  return json({ ok: true, updated, appended });
}

function getRosterSheet() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  let sheet = spreadsheet.getSheetByName(ROSTER_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(ROSTER_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(ROSTER_HEADERS);
    sheet.getRange(1, 1, 1, ROSTER_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
