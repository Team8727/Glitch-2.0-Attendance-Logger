# Revamp: Discord Bot + Display Site with Rotating 4-Digit Team Code

## Goal

Collapse the attendance logger to **two components**: the Discord bot (which also acts
as the backend + API) and the GitHub Pages website (display only). The site shows
Glitch attendance plus a **rotating 4-digit FRC team number that changes every 60
seconds** — students type that number into `/signin` as an expiring 2FA code. Under the
number, the site shows that team's **name and City, State from The Blue Alliance
(TBA)**. Google Sheets / Apps Script / the sign-in form on the site are removed.

## Decisions (confirmed with user)

1. **Hosting:** site stays on **GitHub Pages** (static, display-only); the bot process
   on Replit runs the HTTP API + stores attendance in local JSON files. Google Sheets,
   Apps Script, and the site's sign-in form are dropped.
2. **Team pool:** **fully random** 4-digit numbers (1000–9999). If the number isn't a
   valid/registered team on TBA, pick another **before displaying**.
3. **Site content:** rotating code + TBA info on top; attendance below = **today's
   live list + season stats** (practices held, per-member counts — replaces the Season
   Summary sheet tab for grant docs).
4. **Roster:** CSV **in the repo** (`data/roster.csv`, same format as
   `templates/roster.csv`: Name, Student ID, Subteam, Role, Email). Bot reads it fresh
   on every `/link` — no restart needed; version-controlled, survives Replit resets.
5. **Cleanup:** **full removal** — delete `backend/` and `templates/formulas.txt`;
   rewrite README.md, docs/SETUP.md, bot/README.md. Keep `pages.yml`, `poster/`,
   `tools/`, `templates/roster.csv`.

## Architecture

```
Shop screen / phone ──► GitHub Pages site (display only)
                          │  polls GET /api/state every 20s (CORS)
                          ▼
Discord /link /signin ─► Bot process on Replit ──► The Blue Alliance API v3
                          ├─ data/signins.json     (attendance rows)
                          ├─ data/links.json       (Discord ID → roster name)
                          ├─ data/tba-cache.json   (team info cache, 30-day TTL)
                          └─ data/code-state.json  (current + previous window code)
```

- The bot is the **only** code generator. The site never computes codes; it just
  displays what the API returns, so there is no clock-skew problem.
- Students sign in **only via Discord** (`/signin <4-digit code>`).

## Code rotation algorithm (bot)

- Window = 60s: `windowIndex = Math.floor(Date.now() / 60000)`.
- On each window change: promote `current` → `previous`, install the **pre-fetched**
  next team as `current`. Background pre-fetch starts ~30s before the flip (generates
  random 1000–9999, validates on TBA, retries up to 10 attempts, skips numbers already
  used in the last 20 windows so repeats are rare).
- Validation for `/signin`: code must be numeric 4 digits and equal to the **current**
  or **previous** window's team number (grace for reads right before a flip).
- Persist `{ windowStart, current, previous }` to `data/code-state.json` (atomic
  write, same pattern as `store.js`) so a bot restart mid-window doesn't strand
  students.
- TBA unreachable or retries exhausted at flip time → **degraded mode**: reuse the
  last known valid team for the new window (sign-ins keep working; site shows cached
  TBA info).

## TBA client (`bot/tba.js`)

- `GET https://www.thebluealliance.com/api/v3/team/frc{n}`, header
  `X-TBA-Auth-Key: $TBA_AUTH_KEY`, 10s timeout.
- `200` → `{ nickname, city, state_prov }` → cache in `data/tba-cache.json`
  (TTL 30 days; team data rarely changes).
- `404` → unused team number → caller retries with a new random number.
- `5xx` / network error → TBA-down (not "invalid"); fall back to cache if present.
- Env: `TBA_AUTH_KEY` (required). Rate usage ≈ one lookup per window + retries — well
  within TBA limits.

## Bot API (`bot/server.js`, Node built-in `http` — no new dependencies)

- `GET /api/state` → `200` JSON, `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`:
  ```json
  {
    "ok": true,
    "code": { "teamNumber": 8727, "secondsRemaining": 42 },
    "team": { "number": 8727, "name": "Glitch", "city": "Rochester", "state": "MN" },
    "today": { "date": "2026-10-27", "count": 7,
               "members": [{ "name": "…", "at": "15:02" }] },
    "season": { "practices": 12, "signins": 143,
                "members": [{ "name": "…", "count": 11 }] }
  }
  ```
  One endpoint per poll; when the bot is asleep/failing the site renders an offline
  banner. `season` = computed on read from `signins.json` (distinct practice dates,
  per-member sign-in counts). Sort today's list by time; season members by count desc.
- `TZ`: sign-in day boundaries use server local time; document setting `TZ` (e.g.
  `America/Chicago`) as a Replit secret.

## Bot changes (`bot/`)

- `index.js` — keep env loading + command registration; remove Apps Script `api()` /
  `fetchRoster()`; start the web server alongside `client.login()`; require
  `TBA_AUTH_KEY` at startup (warn-only if absent → degraded display, sign-ins error).
- `roster.js` (new) — load `data/roster.csv` (repo root, resolved relative to the bot
  dir: `path.join(__dirname, "..", "data", "roster.csv")`), override with
  `ROSTER_CSV` env. Columns: Name (required, unique, no apostrophes), Subteam used for
  `/link` labels; the rest ignored. Re-read on each `/link`.
- `attendance.js` (new) — `data/signins.json` store (array of
  `{ ts, name, code }`), promise-queue + atomic writes (copy `store.js` pattern).
  Exposes: `signIn(name, code)` → dedupes per member per local day
  (`{ ok:false, already:true }`), appends; `todayList()`; `seasonStats()`.
- `codes.js` (new) — window state machine + pre-fetch + validation, per algorithm
  above.
- `tba.js` (new) — client + cache per above.
- `store.js` — unchanged (`data/links.json`).
- Commands: `/link` (unchanged semantics), `/signin <code>` — code is now the 4-digit
  team number (validate current/previous window, then dedupe + append, same ephemeral
  replies + public log channel post), `/status` (unchanged). Update the `/signin`
  option description ("the 4-digit team number currently shown on the display site").
- `package.json` — no new dependencies (discord.js v14, Node 18+, global fetch).
  Optional dev affordance: if `WEB_ONLY=1`, skip Discord login and just serve the API
  (local testing).
- `.env.example` — remove `APPS_SCRIPT_URL`; add `TBA_AUTH_KEY` (required),
  `TZ` (recommended), `ROSTER_CSV` (optional), `WEB_ONLY` (optional); keep
  `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `SIGNIN_LOG_CHANNEL_ID`, `LINKS_FILE`.
- `.replit` — unchanged (`cd bot && npm install && npm start`).

## Site revamp (`site/`)

- `config.js` — replace `appsScriptUrl` with `botApiUrl` (the Replit web URL root);
  keep a demo mode when empty (renders sample data, no network).
- `index.html` — no sign-in form. Sections:
  1. Header: GLITCH ROBOTICS.
  2. Code panel: giant 4-digit team number (monospace), countdown bar showing seconds
     to next flip, and beneath it the TBA line: **team name** + **City, ST**
     ("Team info unavailable" fallback).
  3. Attendance: "Today" (count + names with sign-in time, live) and "Season"
     (practices, total sign-ins, per-member counts).
  4. Footer hint: "Sign in on Discord with `/signin <team number>`".
- `app.js` — poll `${botApiUrl}/api/state` on load + every 20s; render; countdown
  derived from `secondsRemaining`; offline banner when fetch fails; demo mode as
  before.
- `styles.css` — restyle for the display layout (large code, read-at-distance);
  keep the existing dark card brand feel.

## Removals & docs

- Delete: `backend/` (Code.gs, appsscript.json, README), `templates/formulas.txt`.
- Rewrite `README.md` (new diagram: QR → Pages display ← bot API; sign-in via Discord
  only), `docs/SETUP.md` (Discord app, TBA key, Replit, Pages, poster, roster CSV,
  validation checklist), `bot/README.md` (env vars, commands, API, checklist,
  troubleshooting: bot asleep, bad TBA key, unused-number retries, reset wipes).
- Keep: `.github/workflows/pages.yml`, `poster/attendance-poster.svg`,
  `tools/generate_qr_poster.py` (poster URL unchanged), `templates/roster.csv`.

## Task order

1. `bot/tba.js` → 2. `bot/codes.js` → 3. `bot/attendance.js` → 4. `bot/roster.js` →
5. `bot/server.js` → 6. wire into `bot/index.js` (commands + startup) →
7. `.env.example` → 8. site revamp (`config.js`, `index.html`, `app.js`,
`styles.css`) → 9. delete `backend/`, `templates/formulas.txt` → 10. rewrite docs →
11. create `data/roster.csv` from the template with a few sample rows.

## Known limitations (accepted, document in README)

- The Pages site is public, so anyone with the URL can read the current code and sign
  in from anywhere. Same trust model as the old system (passcode posted in Discord).
  The 60s expiry mainly bounds the window and proves the signer is looking at a live
  display.
- Free Replit Repls can sleep → site shows "offline" and sign-ins fail until resumed
  (unchanged from today's bot behavior). Replit Deploy fixes it.
- Full Replit project reset wipes `data/*.json` (links + sign-ins). Document a backup
  habit (download `data/signins.json` periodically); roster is safe in-repo.

## Out of scope

- Migrating historical rows from the old Google Sheet (a one-time manual import into
  `data/signins.json` can be done later with a tiny script if wanted).
- Multi-team / multi-instance support, admin web dashboard, notifications.

## Validation

- `node --check bot/*.js site/app.js` (or `node bot/index.js` with `WEB_ONLY=1` and a
  dummy `TBA_AUTH_KEY`) → web server starts, `/api/state` returns code + demo data.
- On Replit with real secrets, walk the checklist:
  - [ ] `/link <roster name>` works; garbage name rejected (roster CSV respected).
  - [ ] Site shows a 4-digit number; under it a real team name + City, ST from TBA.
  - [ ] Number flips every 60s; countdown reaches 0 exactly at the flip.
  - [ ] `/signin` with wrong digit → rejected; with the current number → success +
        `[ts, name, code]` row in `data/signins.json`; site "Today" updates within a
        poll.
  - [ ] `/signin` with the previous window's number right after a flip → accepted
        (grace).
  - [ ] Same member same day again → "already signed in" (no duplicate row).
  - [ ] Set a bogus `TBA_AUTH_KEY` → bot stays up, display shows fallback, sign-ins
        still validate (degraded mode).
  - [ ] Restart the Repl mid-window → current code unchanged (persisted), `/status`
        still shows links.
  - [ ] Site with bot asleep → offline banner; recovers when the Repl resumes.
