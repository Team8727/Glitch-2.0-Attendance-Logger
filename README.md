# Glitch 2.0 Attendance Logger

Sign-in system for the FRC team that doubles as grant / sponsor documentation.

**How it works:** a QR code at the shop opens a **display site** on GitHub Pages.
The site shows a **rotating 4-digit code — the FRC team number** — that changes every
60 seconds, with that team's name and City, State from **The Blue Alliance** underneath.
Students read the number off the display and type it into `/signin` in the team Discord;
the bot validates it against the current 60-second window and records attendance.

```
QR poster at the shop ──► GitHub Pages display site
                              ▲ polls GET /api/state every 20s
                              │
Discord /signin <number> ──► Bot process on Replit ──► The Blue Alliance API v3
                              │  (also serves the display API)
                              ├─ data/signins.json     (attendance rows)
                              ├─ data/links.json       (Discord ID → roster name)
                              ├─ data/tba-cache.json   (team info cache, 30-day TTL)
                              └─ data/code-state.json  (current + previous window code)
```

The bot is the only code generator, and the bot is the backend — there is no Google
Sheets, no Apps Script, and no sign-in form on the site. The site just displays what
the API returns, so a skewed clock on the display screen can't cause a wrong code.

## Repo layout

- `site/` — the static display site served by GitHub Pages (`index.html`, `app.js`,
  `styles.css`, `config.js`). `config.js` holds the one setting: the bot API URL.
  Empty URL = demo mode with sample data.
- `bot/` — the Discord bot **and** the HTTP API it serves (`/link`, `/signin`,
  `/status`). Setup guide: `bot/README.md` (includes Replit hosting steps).
- `data/roster.csv` — the roster (Name, Student ID, Subteam, Role, Email). The bot
  re-reads it on every `/link`, so edits need no restart and it is safe in-repo.
- `.github/workflows/pages.yml` — deploys `site/` to Pages on every push.
- `docs/SETUP.md` — full runbook: TBA key, Discord app, Replit, Pages, poster,
  roster CSV, validation checklist, operations.
- `templates/roster.csv` — bare roster template (names only).
- `poster/attendance-poster.svg` — editable shop poster.
- `tools/generate_qr_poster.py` — generates QR + A4 poster PNGs from the site URL.

## Quick start

1. Follow `docs/SETUP.md`: get a TBA API key → create the Discord app → edit
   `data/roster.csv` → host the bot on Replit → set `botApiUrl` in `site/config.js`
   → enable Pages → print the poster.
2. Students run `/link <roster name>` once, then `/signin <number on the display>` at
   every practice.

## Notes and limitations

- The display site is public, so anyone with the URL can read the current code and
  sign in from anywhere. Same trust model as the old passcode-on-the-whiteboard
  system; the 60-second expiry mainly bounds the window and proves the signer is
  looking at a live display.
- Free Replit Repls can sleep → the display shows an offline banner and sign-ins fail
  until the Repl resumes. Deploy the Repl for always-on hosting.
- A full Replit project reset wipes `bot/data/*.json` (links, sign-ins, code state,
  TBA cache). Export `data/signins.json` periodically as a backup; the roster is safe
  in git.
- Grant documentation: the site's **Season** panel (practices held, total sign-ins,
  per-member counts) replaces the old spreadsheet summary. Raw rows live in
  `bot/data/signins.json`.
