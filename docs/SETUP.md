# Setup runbook — Glitch 2.0 Attendance Logger

This runbook implements the plan in `.kilo/plans/1792526906891-attendance-grant-tracking.md`.
It is pure Google Workspace setup: **no application code is required**.

Time to complete (one pass): ~45–60 minutes. You need one Google account owned by the
team (a dedicated `glitch.attendance@gmail.com` or the team's existing admin account),
and permission to create Forms/Sheets.

---

## Step 1 — Pick the owner account

Use one account that stays with the team (not a graduating student's). Create
everything below from that account. When logged in, note the account name somewhere
durable (e.g., the team's Discord admin channel): this is the single point of failure
if it ever leaves the team.

## Step 2 — Create the spreadsheet

1. Go to sheets.google.com → **Blank spreadsheet**.
2. Rename it `Glitch Attendance 2026-27`.
3. Set the timezone: **File → Settings → General → Timezone** → your region (GRC codes
   never drift if you set this once).
4. Create these tabs (rename `Sheet1` → `Roster`), in order:
   - `Roster`
   - `Sign-ins` (this will actually be the form's responses tab; see Step 4 — for now
     leave it blank)
   - `Presence Matrix`
   - `Season Summary`

## Step 3 — Fill in the Roster

Roster columns (match `templates/roster.csv` exactly; header in row 1, data starts
row 2):

| A        | B            | C        | D        | E                          |
|----------|--------------|----------|----------|----------------------------|
| Name     | Student ID   | Subteam  | Role     | Email                      |
| Camila R | 2417         | Mech     | student  | camila@example.org         |
| ...      | ...          | ...      | ...      | ...                        |

Rules that keep the formulas working:
- **Names must be unique** and have no apostrophes (so `O'Brien` becomes `OBrien`).
- The form dropdown reads column A, so add new members here first.
- Put the owner note in a marker row below the data if you want, e.g. row 1 header:
  `Name | Student ID | Subteam | Role | Email | Owner: <account>`.

You can upload `templates/roster.csv` directly: **File → Import → Upload → Replace current sheet**.

## Step 4 — Create the form

1. From the spreadsheet: **Insert → Form → New form** (this links the form to the
   spreadsheet automatically) — or create a standalone form and link it later via the
   Responses tab's "Link to Sheets".
2. Form title: `Glitch Attendance Sign-in`.
3. Question 1 — **Name**:
   - Type: **Dropdown**
   - Prompt: `Your name`
   - Select the question → ⋮ (three dots) → **"Select answer options from a spreadsheet"** → choose this spreadsheet, `Roster` tab, pick the `Name` column. The dropdown now stays in sync with the roster.
4. Question 2 — **Practice code**:
   - Type: **Short answer** → Required: On
   - ⋮ (three dots) → **Response validation**
   - Rule: **Contains** → the current code, e.g. `GL-1028`
   - Error text: `That's not today's code — re-check the code onscreen or ask a mentor.`
5. *(Optional)* Question 3 — **Location** (dropdown with `Shop / Outreach / Competition`);
   only if you want event vs practice attendance separated. Formulas ignore extra columns.
6. **Settings** → uncheck "Collect email addresses" if a mentor must be allowed to sign in
   anonymously or if students lack accounts; keep it checked if you want a secondary audit
   trail. Your choice — the sheet already records timestamp + name.
7. **Responses** tab of the form → ⋮ → **Select response destination** → new spreadsheet
   (your same file) → **Sign-ins** tab, or accept the auto-created `Responses 1` tab and
   rename it `Sign-ins`. The formulas in Step 6 assume a tab named `Sign-ins` whose
   column A = **Timestamp**, column B = **Name**, column C = **Practice code**.
8. Reorder so the responses land in `Sign-ins` if they didn't; then test once (Step 7).

## Step 5 — Practice passcode rotation (once per practice)

The form validates that the answer **contains** the stored code, so the admin updates
one value before each practice:

1. Open the form → question **Practice code** → ⋮ → Response validation → replace the
   code with today's, e.g. `GL-1103`.
2. Post that code (and only that code) in the team Discord/Slack/Remind a few minutes
   before the practice starts, and have a mentor write it on the whiteboard.

Suggested scheme: `GL-` + practice date, e.g. `GL-1103` for Nov 3. It changes every
practice, so a code leaked on the internet is useless after the day.

> **Accepted limitation:** in a plain Google Form the validation value can be inspected
> in page source. That leaks *today's* code at most — tomorrow it's dead. If abuse ever
> appears, the plan's hardening path is a rotating 4-digit code shown on a shop screen
> (community pattern from teams 3506/10063) or a tiny Apps Script web app. Not needed for v1.

## Step 6 — Build the Presence Matrix and Season Summary

Open the `Presence Matrix` tab and paste these formulas. Google Sheets will ask you to
auto-fill the adjacent cells when a formula spills; accept it.

### Presence Matrix

- **A1:** `Member`
- **B1** (spills right; this is the header row of practice dates):
  `=TRANSPOSE(SORT(UNIQUE(FILTER(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)), Sign-ins!$A$2:$A<>""))))`
  - Select **B1:Z1** → **Format → Number → Date** so columns read `11/3/2026`.
- **A2** (spills down; member list, follows the roster):
  `=SORT(UNIQUE(FILTER(Roster!$A$2:$A, Roster!$A$2:$A<>"")))`
- **B2** (fill across/down: select B2, drag the fill handle over the grid):
  `=IF(SUMPRODUCT(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)=B$1), ARRAYFORMULA(Sign-ins!$B$2:$B=$A2))>0,"Present","Absent")`

Result: every roster member has a row; every day with any sign-in becomes a column;
each cell reads `Present`/`Absent`, recomputed automatically as responses arrive.
Duplicate same-day sign-ins still show `Present` once.

### Season Summary

Headers: `A1 Member | B1 Total sign-ins | C1 Practice days attended | D1 Attendance %`

- **A2:** `=SORT(UNIQUE(FILTER(Roster!$A$2:$A, Roster!$A$2:$A<>"")))`
- **B2:** `=IFERROR(COUNTIF(Sign-ins!$B$2:$B, $A2),0)`
- **C2:** `=IFERROR(COUNT(UNIQUE(FILTER(ARRAYFORMULA(INT(Sign-ins!$A$2:$A)), Sign-ins!$B$2:$B=$A2))),0)`
- **D2:** `=IFERROR(C2/COUNTA('Presence Matrix'!$B$1:$Z$1),0)` → format as percent.

Drag B2/C2/D2 down alongside A. This tab is what you export or screenshot for grant
applications, renewal reports, and Impact Award documentation. Filter/color per subteam
**View → Filter** on the Roster-derived list if you want per-subteam reporting.

> Formulas reference tab names with spaces via quotes. If you renamed tabs, keep
> `Sign-ins` and `Presence Matrix` as-is or update every reference.

## Step 7 — QR code and poster

1. In the form, **⋮ → Send → Link** → copy the short `forms.gle/....` share link.
2. Generate a QR code, either:
   - the form's own share dialog QR (**Send panel**, down arrow next to link → QR code), or
   - our tool:
     ```
     pip install -r tools/requirements.txt
     python3 tools/generate_qr_poster.py "<forms.gle link>"
     ```
     This writes `qr-code.png` and `attendance-poster.png` into `poster/`.
3. Print `attendance-poster.png` (A4) or open `poster/attendance-poster.svg` in a
   vector editor to restyle. Update the placeholder QR in the SVG by overlaying
   `qr-code.png` in its box.
4. Hang two copies: at the shop entrance and at the sign-in table.
5. In the poster's **"Today's code"** box, write the practice code from Step 5.

## Step 8 — Validation checklist (first practice)

- [ ] Scan the QR on a phone → form opens with the roster in the dropdown.
- [ ] Enter a wrong code → submission blocked with the custom error text.
- [ ] Enter the correct code → submit → a row lands in `Sign-ins` with today's timestamp and name.
- [ ] `Presence Matrix` shows a new date column with that member `Present`.
- [ ] A roster member who did not sign in shows `Absent` for that date.
- [ ] `Season Summary` counts are correct after the test.
- [ ] Test a second submit for the same member same day → matrix still shows one `Present`.
- [ ] Admin can view the whole sheet from a phone (Google Sheets app read-only).

## Daily / weekly operations

- **Mentor or admin** updates the passcode in the form before each practice (Step 5).
- **Weekly:** glance at `Presence Matrix`; if someone is missing two weeks straight,
  the team lead checks in with them (attendance data works best when it drives humans).
- **Emergency:** the matrix doubles as an evacuation roster — every member is accounted
  for per practice day. Post the sheet's link in the team Discord for mentors.

## Season rollover (May)

1. **File → Settings** unchanged; create a new spreadsheet `Glitch Attendance <year-year>`.
2. Copy `Roster` as-is (Archive is automatically preserved in the old file).
3. Create the new form's spreadsheet link or copy the form and re-link responses to the
   new file (`Responses → Select response destination`).
4. Re-paste the formulas from Step 6 (they reference the new tabs).
5. Archive: old file lives forever in Drive. Grant funders only ever see the export of
   the sheet; the raw `Sign-ins` log stays available for audit.

## Failure modes and mitigations

| Problem | Mitigation |
|---|---|
| Student without a phone/data | Paper sign-in sheet beside the QR; admin adds their row to `Sign-ins` with the practice time. |
| Duplicate or mistaken submit | Matrix formula dedupes; delete the raw row in `Sign-ins` directly — the log stays auditable. |
| Leaked passcode | Accepted for v1 (code dies next practice). If abused: rotating screen code (plan hardening). |
| Roster changes mid-season | Add/remove names in `Roster` only; dropdown and formulas follow automatically. |
| Dropping roster rows breaks the form dropdown | Google Forms links a snapshot; re-run "Select answer options from a spreadsheet" on the Name question to refresh. |
| Timezone skew | Set once in File → Settings (Step 2). |
| Owner leaves the team | Transfer ownership via Drive sharing settings on both Sheet and Form before they leave. |