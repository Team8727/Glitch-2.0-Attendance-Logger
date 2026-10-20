# Glitch 2.0 Attendance Logger

Sign-in system for the FRC team that doubles as grant / sponsor documentation.

**How it works:** a QR code at the shop opens a Google Form. Students pick their name
from a dropdown and enter the practice's passcode. Each submission writes a name +
timestamp directly to a Google Sheet, which builds a per-day presence matrix and a
season summary for grant reports.

**Deliberately simple:** plain Google Form + Google Sheets. No servers, no code to
operate, no hosting costs. "Glitch 2.0" is the project name, not a web domain.

## Repo layout

- `docs/SETUP.md` — the full runbook: create the spreadsheet, form, formulas, QR poster, and first-practice checklist.
- `templates/roster.csv` — roster template with the exact column order the form dropdown and formulas expect.
- `templates/formulas.txt` — copy-paste Google Sheets formulas for the Presence Matrix and Season Summary tabs.
- `poster/attendance-poster.svg` — printable shop poster (SVG template).
- `tools/generate_qr_poster.py` — generates the QR code PNG and a printable poster once the form URL exists.
- `tools/requirements.txt` — `pip install -r tools/requirements.txt` to run the QR tool.

## Quick start

1. Read `docs/SETUP.md` and follow steps 1–8 (owner account, spreadsheet, roster, form, formulas, QR poster).
2. Announce the first practice's passcode in the team Discord/Slack.

Everything below lives in one Google Workspace account owned by the team so the data
survives forever. Pick one mentor/admin as owner and record it in the Roster tab header.