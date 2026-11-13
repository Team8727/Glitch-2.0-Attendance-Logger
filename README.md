# Glitch 2.0 Attendance Logger

Sign-in system for FRC Team 8727 that doubles as grant / sponsor documentation.

**How it works:** a QR code at the shop opens a **display site** on GitHub Pages.
The site shows a **rotating 4-digit code — the FRC team number** — that changes every
60 seconds, with that team's name and City, State from **The Blue Alliance** underneath.
Students read the number off the display and type it into `/signin` in the team Discord;
the bot validates it against the current 60-second window and records attendance.

```
QR poster at the shop ──► GitHub Pages display site
                              ▲ polls GET /api/state every 20s
                              │
Discord /signin <number> ──► Discord bot (separate repo) ──► Attendance service
                                                              │
                                                              ├─ data/signins.json
                                                              ├─ data/links.json
                                                              ├─ data/tba-cache.json
                                                              └─ data/code-state.json
```

This repo owns the **attendance domain**: the rotating code, roster, JSON stores,
HTTP API, and display site. The Discord bot lives in
[`glitch-2.0-discord-bot`](https://github.com/Team8727/glitch-2.0-discord-bot) and
calls the internal API routes with a shared `BOT_API_KEY`.

## Repo layout

- `service/` — the attendance backend and HTTP API. Setup: `service/README.md`.
- `site/` — the static display site served by GitHub Pages (`index.html`, `app.js`,
  `styles.css`, `config.js`). `config.js` holds the one setting: the API URL.
  Empty URL = demo mode with sample data.
- `data/roster.csv` — the roster (Name, Student ID, Subteam, Role, Email). The service
  re-reads it on every `/link`, so edits need no restart and it is safe in-repo.
- `.github/workflows/pages.yml` — deploys `site/` to Pages on every push.
- `docs/SETUP.md` — full runbook: TBA key, Discord app, service hosting, Pages, poster,
  roster CSV, validation checklist, operations.
- `templates/roster.csv` — bare roster template (names only).
- `poster/attendance-poster.svg` — editable shop poster.
- `tools/generate_qr_poster.py` — generates QR + A4 poster PNGs from the site URL.

## Quick start

1. Follow `docs/SETUP.md`: get a TBA API key → create the Discord app → edit
   `data/roster.csv` → host the service → set `botApiUrl` in `site/config.js` →
   enable Pages → print the poster.
2. Deploy the Discord bot from `glitch-2.0-discord-bot` and point it at this service.
3. Students run `/link <roster name>` once, then `/signin <number on the display>` at
   every practice.

## Notes and limitations

- The display site is public, so anyone with the URL can read the current code and
  sign in from anywhere. Same trust model as the old passcode-on-the-whiteboard
  system; the 60-second expiry mainly bounds the window and proves the signer is
  looking at a live display.
- The service must be reachable by both the display site and the bot. Keep it off the
  VPN; route only the bot through NordVPN.
- `service/data/*.json` is the attendance record. Back it up periodically; the roster
  is safe in git.
- Grant documentation: the site's **Season** panel (practices held, total sign-ins,
  per-member counts) replaces the old spreadsheet summary. Raw rows live in
  `service/data/signins.json`.
