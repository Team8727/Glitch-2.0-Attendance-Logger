# FRC Attendance Tracking for Grants — Glitch 2.0

## Goal

Give the FRC team a low-effort sign-in system whose output doubles as grant/support documentation:

- Students scan a QR code at the shop, open a **Google Form**, pick their name from a dropdown, enter the **practice passcode**, and submit.
- Each submit auto-writes a **name + timestamp** row to a Google Sheet (tied to the form).
- An admin later opens the Sheet and sees attendance **organized by day** (who was present/absent) and per-member totals suitable for grant applications, renewal reports, and Impact Award documentation.

Deliberately plain: Google Form + Google Sheets. No custom web app, no hosting, no domain needed. The "Glitch 2.0" name is the project name, not a real domain.

The repo (`Glitch-2.0-Attendance-Logger`) is currently empty/greenfield — this plan is pure Google Workspace setup, executed by hand or by an implementation-capable agent with Google access.

## Research: what other FRC teams do

Community consensus (Chief Delphi threads "Use of Attendance Tracking", "Attendance/Build Hour Tracking Solutions For 2022", "Implementing a Sign In system", "Timekeeping and Attendance System", "Automated Attendance Tracking"):

1. **Why teams track** — grant/sponsor reports (teams explicitly cite "donors that donate based on # of hours volunteered"), district/school reporting, travel-eligibility thresholds (30/50/70/100-hour rules), emergency/evacuation rosters, and awards documentation.
2. **Dominant simple pattern** — QR code at the entrance → Google/Microsoft Form → responses land in a Spreadsheet. Multiple teams run exactly this.
3. **Anti-abuse pattern** — because plain forms can be submitted from anywhere, several teams use a code that rotates or matches the current practice:
   - Team 3506: Discord bot + 4-digit code on a screen by the door, rotating every 30 seconds.
   - Team 10063 area (Kron app): email/barcode sign-in at a kiosk.
   - Others: time-matched QR codes on a shop display.
4. **Built/self-run systems** for reference (all open source or commercial, all feed Google Sheets):
   - **Team 66 — GrizzlyTime** (github.com/YCSRobotics/GrizzlyTime): Java + Google Sheets + barcode scanner (USB), 6-digit ID.
   - **Team 5892 — HeroHours** (github.com/FRC5892/HeroHours): HTML/JS web app, Google Sheets + Apps Script backend, runs on a Raspberry Pi kiosk with barcode scanner.
   - **Team 6328 — AdvantageTrack** (github.com/Mechanical-Advantage/AdvantageTrack): WiFi-sniffing auto-attendance via device MAC addresses + manual sign-in, data to Google Sheets.
   - **Team 254 — Cheesy Hours** (github.com/Team254/cheesy-hours): web app, leaderboard, hours factored into travel decisions.
   - **Team 4909 — BionicAttend**: Go web app on a Raspberry Pi/Balena.
   - **onlycs/attendance** (2026): QR login, encrypted student data, hour *types* (build/learning/offseason/outreach), admin dashboard — closest modern match to a full tracker.
   - Off-the-shelf: Jibble, myTimeStation, OpenTimeClock, Kron.
5. Lessons from the threads: keep friction near zero ("no excuse not to check in"); start simple ("Sheets work; starting small is fine"); assign one person as owner; paper is fine but doesn't scale for reporting; biometric/tracking hardware adds complexity and continuity risk (abandoned projects when the builder graduates).

This plan adopts the community's simplest robust pattern (QR → Form → Sheets) plus the rotating-practice-passcode idea.

## Chosen design

### Sign-in flow
1. QR poster at the shop entrance (URL = short link to the Google Form).
2. Student scans → Form opens on their phone.
3. Question 1 "Name": **Dropdown** populated from the Roster tab (Google Forms native "select from spreadsheet").
4. Question 2 "Practice code": short-answer with **response validation**; admin updates the expected code per practice.
5. Submit → response auto-logged with a timestamp (Google Forms default) into the form's linked spreadsheet.

### Spreadsheet layout (one file, e.g. "Glitch Attendance 2026-27")
- **Tab 1 — Roster** (input, admin-maintained): `Name | Student ID | Subteam | Role (student/mentor) | Email(optional)`. This is the dropdown source. The single roster source of truth.
- **Tab 2 — Sign-ins** (auto, the form responses tab): `Timestamp | Name | Practice code`. Kept clean — never hand-edit; use a new form-linked tab per season (Forms "move to separate sheet" after season end).
- **Tab 3 — Presence Matrix** (formula-driven, read-only): rows = members from Roster, columns = practice dates from Sign-ins, cell = `Present`/`Absent`. Built from a `QUERY`/pivot (e.g., `QUERY('Sign-ins'!A:B,"select A, count(A) group by A pivot B")` or a `PIVOT`/`UNIQUE` combo) so it updates automatically as responses come in. `Absent` = roster member with no row for that date (Index/Match against the matrix).
- **Tab 4 — Season Summary** (formula-driven): per member — total sign-ins, total hours (if a duration source exists), attendance % of practice days. This is the tab exported/PDF'd for grant reports.

### Passcode rotation (per practice)
- Form validation rule: "Short answer" → Response validation → "Text contains" the current code, e.g. `GL-1031`.
- Admin updates the expected code before each practice (about 20 seconds in the Form editor). Suggested scheme: `GL-<MMDD>`.
- **Caveat (accepted):** plain Google Form validation values are inspectorable in page source; a determined student could read the stored code. This is low-risk because the code changes each practice and the QR points at a form. If abuse ever appears, harden later with the pattern above (rotating 4-digit code on the shop screen, or a small Google Apps Script web app that validates the code server-side) — out of scope for v1.

### QR code
- Shorten the form URL (any shortener; or use the built-in `forms.gle` link from the Form's share dialog).
- Generate a QR (any generator; alternatively the Form's QR via share dialog).
- Print at least two posters: water level vision in the shop entrance and near the sign-in table.

## Setup steps

1. Create the Google Spreadsheet `Glitch Attendance 2026-27` with tabs Roster / Sign-ins / Presence Matrix / Season Summary.
2. Populate Roster with the current team members (Name, ID, Subteam, Role).
3. Create a Google Form:
   - Q1 Name → Dropdown → three-dot menu → "Select from spreadsheet" → Roster tab, `Name` column.
   - Q2 Practice code → Short answer → Response validation (see rotation rules).
   - Toggle response collection on; link responses to the spreadsheet (creates the automatic responses tab row; consider renaming it, but note the form writes to the responses tab regardless).
   - Optional demo/practice date question if the team ever meets off-site (outreach/events) — a third question "Location" with a dropdown keeps event attendance separate from practices in the matrix.
4. Set up Presence Matrix with `QUERY` pivot formulas (see Design); set `Absent` logic against Roster × dates.
5. Set up Season Summary with per-member counts + attendance %.
6. Set up the QR poster (short URL + QR) and hang it in the shop.
7. Confirm first practice passcode; announce via team Discord/Slack/Remind.

## Validation checklist

- [ ] Open the QR/form on a phone → name dropdown shows only roster members.
- [ ] Wrong practice code → form refuses submission (validation error message shown).
- [ ] Correct code → submit → provider: new row appears in Sign-ins with today's timestamp and name.
- [ ] Second submit for same member same day → duplicate row appears (accepted); matrix must show `Present` once (formula counts ≥1).
- [ ] Presence Matrix reflects the test sign-in for today's column; a roster member with no sign-in shows `Absent`.
- [ ] Season Summary shows correct per-member totals.
- [ ] Admin can view the Sheet from a phone (Google Sheets app) without editing.

## Failure modes and mitigations

- **Students forgot/lost phones or data** → adjacent paper sign-in sheet + physical add by admin; note in Roster-only edits.
- **Duplicate or mistaken submits** → matrix formula dedupes; admin filters/deletes the sign-in row directly (raw data is auditable).
- **Passcode spoofing** → accepted v1 risk; mitigate later with the rotating-screen-code or Apps Script hardening if seen.
- **Roster changes mid-season** → dropdown updates automatically from Roster tab; matrix is formula-driven so it follows.
- **Form deaths from spreadsheet answers** → Google Forms dropdown-from-range only reads the range; deleting Roster rows can break the form's answer mapping (Google recommends keeping source values or re-selecting the range) — keep a value-cache column or recreate the question if the dropdown breaks.
- **Timezone** → Form timestamps default to the sheet's timezone; set spreadsheet timezone once under File → Settings.
- **Season rollover** → at season end, point the form at a new spreadsheet or archive the Sign-ins tab ("Separate response destination") so the matrix stays fast and the new season starts clean.
- **Continuity** → pick one mentor/admin to be the owner account of the Sheet + Form, and document that in a short "Owner:" cell in the Roster tab header.

## Out of scope (v1)

- Custom web app, team domain, or kiosk/hardware (barcode/NFC/RFID, WiFi sniffing).
- Hour *durations* (check-in/check-out pairs) — if a grantor later requires hours, upgrade the Form to include a check-out step or an Apps Script helper; the Season Summary tab is already structured for it.
- Per-event / outreach roster tracking (covered later by the optional Location question or a second form).
- Automatic emails/reports.

## Implementation notes

- Implementer needs Google account access (the team's Google Workspace/Gmail account that will own the Sheet and Form). Create everything under one owner for continuity.
- No code is required for v1; if the implementer is an agent, its job is to produce the exact steps/checkbox outputs above and the poster files, not to write application code.