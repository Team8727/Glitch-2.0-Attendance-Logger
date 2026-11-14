/**
 * Glitch 2.0 attendance → Google Sheets webhook.
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
const TAB_NAME = 'Sign-ins';
const SECRET = 'PASTE_SHEETS_WEBHOOK_SECRET_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return json({ ok: true, appended: 0 });

    const sheet = getSheet();
    const existing = existingKeys(sheet);
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
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'glitch-attendance-sheets' });
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  let sheet = spreadsheet.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TAB_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Name', 'Code', 'Source']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function existingKeys(sheet) {
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

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
