# Glitch 2.0 Attendance — Google Apps Script backend

This folder is the free API backend that lets the GitHub Pages sign-in page write to
your Google Sheet. Google Apps Script answers `list` (roster for the dropdown) and
`signin` (validate passcode, append the row) via JSONP, so no CORS/proxy is needed.
It reads and writes the **same spreadsheet** from the spreadsheet setup — the presence
matrix formulas are unchanged.

## Files

- `Code.gs` — the app (JSONP endpoints, passcode check, roster read, sign-in append).
- `appsscript.json` — manifest (timezone + V8 runtime). Adjust the timezone to your region.

## Deploy once (≈10 minutes)

1. Go to https://script.google.com and create a **New project** named
   `Glitch Attendance Backend`.
2. Delete the default `Code.gs` content and paste the contents of this folder's
   `Code.gs`. Use **⋮ → Show project settings** → *appsscript.json manifest file in
   editor* is shown automatically when you open files in the editor grid — paste this
   folder's `appsscript.json` into the `appsscript.json` file (edit the timezone if
   needed).
3. In `Code.gs`, replace:
   ```js
   var SHEET_ID = "REPLACE_WITH_YOUR_SPREADSHEET_ID";
   ```
   with the ID from your spreadsheet URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`.
4. Make sure the spreadsheet has a **Config** tab (see docs/SETUP.md) with rows:
   `passcode`, `passcode_date`, `require_passcode`.
5. **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me** (the sheet owner account)
   - Who has access: **Anyone** (students' phones don't need Google accounts)
   - Click **Deploy** and authorize the script (read/write access to the spreadsheet).
   - If your school/workspace only allows "Anyone with Google account", pick that and
     let students use whatever account is on their phone.
6. Copy the **Web app URL** (ends in `/exec`). It goes into `site/config.js`:
   ```js
   appsScriptUrl: "https://script.google.com/macros/s/XXXX/exec"
   ```

## Test the deployment

Open the web app URL in a browser with these parameters:

- Roster: `?action=list` → JSON array `members` with every roster name.
- Wrong code: `?action=signin&member=Camila%20R&code=WRONG` → `ok:false` with the
  "wrong code" message.
- Right code (set in Config first): → `ok:true` and a row appears in **Sign-ins**.
- Repeat the same member+code → `ok:false, already:true`.

## Notes & limits

- One script deploys URL = one backend; re-deploy (Create new deployment) whenever you
  change `Code.gs`, and put the new URL in `site/config.js`.
- Apps Script is free; it has generous daily quotas, far above one team's usage.
  If the page ever says "Server error", check *Executions* in the Apps Script editor.
- The passcode lives **server-side** in the spreadsheet's Config tab now — the page
  source leak from the old form is gone. The toggle to require a passcode at all is
  the Config `require_passcode` value.
- Authors are logged only by name + timestamp (per the plan). Nothing personal beyond
  the roster is collected.