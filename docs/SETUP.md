# Setup runbook — Glitch 2.0 Attendance Logger

Implements `.kilo/plans/1792526906891-attendance-grant-tracking.md`, evolved to a
GitHub Pages sign-in app. Flow:

```
QR at the shop → https://team8727.github.io/Glitch-2.0-Attendance-Logger/
     → dropdown: pick your name → enter today's passcode → Submit
     → Apps Script backend (free) validates passcode server-side
     → appends Timestamp + Name + Code to the 'Sign-ins' tab
     → 'Presence Matrix' & 'Season Summary' tabs update automatically
```

Requires one Google account (the owner), one spreadsheet, one Apps Script project, and
this repo pushed to GitHub. No servers, no hosting costs, no custom domain.

---

## Step 1 — Owner account

Everything below is created from one account that stays with the team (not a
graduating student's). Record that account in the team Discord so ownership never
becomes a mystery.

## Step 2 — Create the spreadsheet

1. sheets.google.com → **Blank spreadsheet** → rename to `Glitch Attendance 2026-27`.
2. **File → Settings → Timezone** → your region (set once).
3. Create these tabs (rename `Sheet1`):

   | Tab | Purpose | Who edits |
   |---|---|---|
   | `Roster` | Member list — the single source of truth | Mentor/admin |
   | `Config` | Practice passcode (rotates) | Mentor/admin |
   | `Sign-ins` | Raw rows appended by the backend (Timestamp, Name, Code) | Backend (auto) |
   | `Presence Matrix` | Present/Absent per member per practice day | Formulas (auto) |
   | `Season Summary` | Totals for grant reports | Formulas (auto) |

## Step 3 — Fill in the Roster

Columns (matches `templates/roster.csv`; header row 1, data row 2+):

`Name | Student ID | Subteam | Role | Email`

Rules that keep everything working:
- **Names unique**, no apostrophes (`O'Brien` → `OBrien`).
- New members are added here first — the site dropdown follows automatically.
- Import the template: **File → Import → Upload → Replace current sheet.**

## Step 4 — Create the Config tab

Tab `Config`, header row 1: `Key | Value`. Rows from row 2:

| Key | Value | Meaning |
|---|---|---|
| `passcode` | `GL-1103` | Today's code (validate code students enter) |
| `passcode_date` | `2026-11-03` | Code expires at midnight; mismatch = rejected |
| `require_passcode` | `TRUE` | Set `FALSE` only to open sign-in during non-practice hours |

**Before every practice**, the admin updates `passcode` (and `passcode_date`) — one
cell, takes ten seconds. Scheme: `GL-` + practice date, e.g. `GL-1103`. Post the code
in Discord/on the whiteboard at the shop.

## Step 5 — Deploy the backend (once, ~10 min)

Follow `backend/README.md` end to end:

1. script.google.com → New project → paste `backend/Code.gs` (+ manifest).
2. Set `SHEET_ID` to the spreadsheet ID (from its URL).
3. **Deploy → Web app** → Execute as **Me**, access **Anyone** → copy the `/exec` URL.

Result: `https://script.google.com/macros/s/XXXX/exec`, which the sign-in page calls.

## Step 6 — Point the site's config at the backend

Edit `site/config.js` in this repo:

```js
appsScriptUrl: "https://script.google.com/macros/s/XXXX/exec",
```

Leave it empty to run the UI in **demo mode** (sample roster, code `GL-0000`, no
spreadsheet writes) — handy for testing the page before the backend exists.

## Step 7 — Deploy to GitHub Pages

The repo already contains `.github/workflows/pages.yml`, which publishes the `site/`
folder whenever you push.

1. Push the branch to GitHub:
   ```
   git push -u origin attendance-signin-v1
   ```
2. In the GitHub **repo → Settings → Pages**: under "Build and deployment",
   set **Source: GitHub Actions** (one-time, browser click).
3. The next push (or **Actions → Deploy to GitHub Pages → Run workflow**) publishes
   the site.

If the "GitHub Actions" source isn't available (older plans), use the classic path
instead: Settings → Pages → Source **Deploy from a branch** → branch `main` /
`/ (root)`. That serves the repo root, so first move `site/*` to the repo root and
add a `.nojekyll`. The Actions path above is simpler and safer (only `site/` is
published, never `.kilo/` or other repo files).

## Step 8 — QR code and poster

1. Final URL: `https://team8727.github.io/Glitch-2.0-Attendance-Logger/`
   (prod URL is shown at the bottom of the Actions run's page and on Settings → Pages).
2. Generate the poster with the tool:
   ```
   pip install -r tools/requirements.txt
   python3 tools/generate_qr_poster.py "https://team8727.github.io/Glitch-2.0-Attendance-Logger/"
   ```
   Outputs `poster/qr-code.png` and `poster/attendance-poster.png` (A4).
3. Print two copies: shop entrance and sign-in table. In the "Today's code" box write
   the value from Config (Step 4).
4. `poster/attendance-poster.svg` is the editable source if you want to restyle.

## Step 9 — Validation checklist

- [ ] Open the Pages URL on a phone → dropdown lists every Roster name.
- [ ] Enter a short/empty code → rejected client-side.
- [ ] Enter a wrong code → "not today's code" from the backend (shake).
- [ ] Enter the correct code → success message; a row lands in `Sign-ins` with today's timestamp.
- [ ] Same member again same day → "already signed in for today" (no duplicate row).
- [ ] `Presence Matrix` gains today's column, that member `Present`, other roster members `Absent`.
- [ ] `Season Summary` counts are correct.
- [ ] Wrong code after midnight (with `passcode_date` set to yesterday) → rejected.
- [ ] Backend authorizations were done once (Step 5) and ownership is the team account.

## Daily / weekly operations

- **Per practice:** admin updates Config `passcode` + `passcode_date` (Step 4); write
  the code on the whiteboard.
- **Weekly:** glance at `Presence Matrix`; two missing weeks → lead checks in (this is
  what makes the data *do* something).
- **Emergency:** the matrix doubles as an evacuation roster; share the sheet link with
  all mentors in Discord.
- **Grant time:** export `Season Summary` (File → Download) or screenshot it for grant
  applications, renewal reports, and Impact Award documentation. Raw rows stay in
  `Sign-ins` for audit.

## Season rollover (May)

1. New spreadsheet `Glitch Attendance <year-year>`; copy `Roster` and `Config` over.
2. Update `SHEET_ID` in `backend/Code.gs` and re-deploy the Apps Script (new URL →
   `site/config.js`).
3. Re-paste the matrix/summary formulas (Step below remains identical).
4. Old files live in Drive forever; funders only ever see exports.

## Presence Matrix & Season Summary formulas

### Presence Matrix

- **A1:** `Member`
- **B1** (spills right; practice-date headers):
  `=TRANSPOSE(SORT(UNIQUE(FILTER(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)), Sign-ins!$A$2:$A<>""))))`
  Then **B1:Z1 → Format → Number → Date**.
- **A2** (spills down):
  `=SORT(UNIQUE(FILTER(Roster!$A$2:$A, Roster!$A$2:$A<>"")))`
- **B2** (drag fill across/down):
  `=IF(SUMPRODUCT(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)=B$1), ARRAYFORMULA(Sign-ins!$B$2:$B=$A2))>0,"Present","Absent")`

These are also in `templates/formulas.txt` (copy-paste ready).

### Season Summary

Headers `A1 Member | B1 Total sign-ins | C1 Practice days attended | D1 Attendance %`:

- **A2:** `=SORT(UNIQUE(FILTER(Roster!$A$2:$A, Roster!$A$2:$A<>"")))`
- **B2:** `=IFERROR(COUNTIF(Sign-ins!$B$2:$B, $A2),0)`
- **C2:** `=IFERROR(COUNT(UNIQUE(FILTER(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)), Sign-ins!$B$2:$B=$A2))),0)`
- **D2:** `=IFERROR(C2/COUNTA('Presence Matrix'!$B$1:$Z$1),0)` → format as percent.

## Failure modes and mitigations

| Problem | Mitigation |
|---|---|
| Student without a phone/data | Paper sign-in sheet beside the QR; mentor appends the row to `Sign-ins` with the practice time. |
| Backend "Server error" | Check Apps Script **Executions**; verify `SHEET_ID`, tab names, and that deployment access is `Anyone`. |
| Backend returns old data after editing Code.gs | Re-deploy (new creation) and update the URL in `site/config.js`. |
| Passcode leaked | Dies at midnight via `passcode_date`. Long season root: rotate daily. |
| Roster changes mid-season | Edit `Roster` only; dropdown + matrix follow. |
| Pages shows stale content | Push again or run the `Deploy to GitHub Pages` workflow; check the Actions log. |
| `.kilo/` or private files accidentally published | Not possible with the Actions path — only `site/` artifacts are uploaded. |
| Owner leaves the team | Transfer Drive ownership of sheet + Apps Script before they go; update the team Discord record. |