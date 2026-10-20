# Glitch 2.0 Attendance Logger

Sign-in system for the FRC team that doubles as grant / sponsor documentation.

**How it works:** a QR code at the shop opens a small web app hosted on **GitHub
Pages**. Students pick their name from a dropdown and enter the practice's passcode.
The page calls a free **Google Apps Script** backend that validates the passcode
server-side and appends `Timestamp + Name + Code` straight into a Google Sheet, which
builds a per-day presence matrix and a season summary for grant reports.

```
QR at the shop → GitHub Pages app (this repo, site/) → Apps Script backend → Google Sheet
                                                     └ passcode check, appends row
```

No servers to run, no hosting costs, no custom domain.

## Repo layout

- `site/` — the static sign-in app served by GitHub Pages (`index.html`, `app.js`,
  `styles.css`, `config.js`). `config.js` holds the one setting: the backend URL.
- `backend/` — Google Apps Script backend (`Code.gs`, `appsscript.json`) + its own
  `README.md` with deploy steps.
- `.github/workflows/pages.yml` — deploys `site/` to Pages on every push.
- `docs/SETUP.md` — full runbook: spreadsheet/tabs, Config passcode, backend deploy,
  Pages enable, QR poster, validation checklist, formulas.
- `templates/roster.csv` — roster template (column order the dropdown and formulas expect).
- `templates/formulas.txt` — copy-paste Presence Matrix / Season Summary formulas.
- `poster/attendance-poster.svg` — editable shop poster.
- `tools/generate_qr_poster.py` — generates QR + A4 poster PNGs from the site URL.

## Quick start

1. Follow `docs/SETUP.md` steps 1–8:
   spreadsheet + tabs → Roster → Config → backend deploy (`backend/README.md`) →
   set `appsScriptUrl` in `site/config.js` → push → enable Pages → print poster.
2. Each practice: update the Config `passcode` cell, post it in Discord, write it on
   the whiteboard.

Data lives in one team-owned Google account and survives every season.