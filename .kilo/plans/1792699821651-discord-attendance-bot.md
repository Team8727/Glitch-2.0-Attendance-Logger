# Discord Attendance Bot — Glitch 2.0

## Goal

Add a Discord bot so students sign in to the existing attendance Google Sheet from the
team server. A student links their Discord account to their roster name once (`/link`),
then signs in each practice with `/signin <code>`. The bot reuses the existing Google
Apps Script backend, so rows are appended to the **same `Sign-ins` tab** the web app
writes to (same destination), and the existing `Presence Matrix` / `Season Summary`
formulas keep working with no changes.

**Both sign-in paths stay live in parallel:** the QR web app keeps working, and students
may use the QR code **or** the Discord bot — each student uses one, never both. Both
paths call the same backend and append to the same `Sign-ins` tab. The backend's
per-member-per-day "already signed in today" check runs before every append regardless of
channel, so a student who already signed in via the QR app is rejected if they try the bot
(or vice versa) — no duplicate rows, no double counting.

## Existing system (context, unchanged)

- `backend/Code.gs` — Apps Script web app, deployed "Anyone" access, serves JSONP/JSON:
  - `GET ?action=list` → `{ ok:true, members:[{name, subteam}] }` from the `Roster` tab.
  - `GET ?action=signin&member=NAME&code=CODE` → validates the daily `passcode` from the
    `Config` tab, dedupes ("already signed in today"), appends `[Timestamp, Name, Code]`
    to the `Sign-ins` tab. Returns `{ok:true,name}` / `{ok:false,already:true,error}` /
    `{ok:false,error}`.
  - When no `callback` param is sent, it returns plain JSON (not JSONP) — server-side
    callers can `fetch` the `/exec` URL directly (follow the 302 redirect; Node 18+
    global `fetch` does this by default).
- Sheet layout: `Roster` (A=Name, C=Subteam), `Config` (passcode / passcode_date /
  require_passcode), `Sign-ins` (A=Timestamp, B=Name, C=Code). Roster names are unique.
- The Apps Script URL already exists (same one set in `site/config.js`).

## Decisions (confirmed with user)

- **Stack:** Node.js + discord.js v14 (JS already used throughout the repo).
- **Identity:** one-time `/link <name>`, then `/signin`. Mapping stored in a bot-local
  JSON file (persists on Replit's filesystem). Prevents impersonation.
- **Passcode:** keep the daily practice passcode; the bot sends it to the backend for
  validation. No security-model change. (Code is already posted in the team Discord.)
- **Hosting:** Replit, imported from GitHub, run from `bot/`. README is the setup guide.

## New files in `bot/`

- `bot/package.json` — `discord.js` v14, `engines.node >= 18` (Replit default is fine).
  Uses Node's global `fetch`; no other runtime dependencies.
- `bot/index.js` — client setup, slash-command registration, command handlers,
  `fetch`-based wrapper for the Apps Script endpoints, startup link to backend.
  - `fetchJson(url)` helper: `fetch(url, { redirect: "follow" })` then `.json()`; wraps
    timeouts and non-JSON responses into a friendly error.
  - Command registration: per-guild when `GUILD_ID` is set (instant), else global.
- `bot/store.js` — JSON persistence for Discord-ID → roster-name links at
  `bot/data/links.json`. Serialize writes through a promise queue; write atomically
  (temp file + rename) to avoid corruption. Exports `get(userId)`, `set(userId, name)`,
  `all()`.
- `bot/.env.example` — documents every env var (see Config below). Not committed with
  values.
- `bot/README.md` — setup guide: Discord app creation + invite, Replit import + Secrets,
  run command, verification checklist, troubleshooting (backend errors, sleeping repl,
  adding members to roster). This is the deliverable "guide me through setup" piece.
- `bot/data/` — runtime links file (gitignored; created on first run).

## Commands

- `/link <name>` — fetch roster via `?action=list`; if `name` (case-insensitive) matches
  a roster member, store `discordUserId → canonical roster name` and reply ephemerally
  with the canonical name. If the user is already linked, overwrite (allows corrections).
  Rejects names not on the roster with the backend's "not on the roster" style message.
- `/signin <code>` — resolve the user's linked name; if unlinked, reply
  "You need to /link first." Send `?action=signin&member=<name>&code=<code>`. Map
  responses:
  - `ok:true` → ephemeral "Signed in, <name>" (+ optional public message in
    `SIGNIN_LOG_CHANNEL_ID`, if set).
  - `ok:false, already:true` → "You're already signed in for today."
  - `ok:false` → show the backend `error` message.
  - fetch/network failure → "Couldn't reach the attendance server — try again or tell a
    mentor."
- `/status` — ephemeral: show the linked roster name or "not linked yet."

All replies are ephemeral unless the public log channel is configured.

## Config (env / Replit Secrets)

- `DISCORD_TOKEN` — bot token from Discord Developer Portal.
- `CLIENT_ID` — application ID from the Developer Portal.
- `GUILD_ID` — team server ID (optional; speeds up command registration).
- `APPS_SCRIPT_URL` — the existing `/exec` URL (same value as `site/config.js`).
- `SIGNIN_LOG_CHANNEL_ID` — optional channel ID for a public "X signed in" message.
- `LINKS_FILE` — optional override of the links store path (default `data/links.json`).

## Repo changes

- Add `bot/` as above.
- Update `.gitignore`: add `/bot/.env`, `/bot/data/`, `/bot/node_modules/`.
- `backend/Code.gs`, `site/`, `docs/SETUP.md` — **unchanged**. (Optionally add a one-line
  note in `docs/SETUP.md` that a Discord bot path also exists; cosmetic, not required.)

## Discord application setup (documented in `bot/README.md`)

1. https://discord.com/developers/applications → New Application ("Glitch Attendance").
2. Bot → Add Bot → copy the **TOKEN**.
3. OAuth2 → URL Generator → scopes `bot` + `applications.commands`; bot permissions:
   Send Messages, Embed Links, View Channels, Read Message History → copy invite URL →
   invite to the team server.
4. With Developer Mode on, right-click the server → Copy Server ID (`GUILD_ID`); copy
   the Application ID from General Information (`CLIENT_ID`).
5. No privileged intents are needed (slash commands only).

## Replit setup guide (documented in `bot/README.md`)

1. replit.com → New Repl → **Import from GitHub** → this repo URL.
2. In the left panel, open the **Secrets** tool (key icon) and add each env var from
   `.env.example` (never commit real tokens). On Replit, Secrets are exported as env
   vars at runtime.
3. Set the run command to `cd bot && npm install && npm start` (via the Run-button
   config or a `bot/.replit` file placed at the project root on import).
4. Run. The bot registers commands on startup (a fresh guild registration can take a few
   seconds).
5. Note: free-tier Repls may sleep after idle; an active Discord websocket keeps the bot
   awake, but if uptime issues appear, deploy as a hosted/autoscale Repl. Keep the links
   store in `bot/data/` (persistent filesystem) so `/link` survives restarts.

## Verification checklist

- [ ] `?action=list` reachable from the bot (startup health check logs roster size).
- [ ] `/link <roster name>` → ephemeral confirmation; `/link <bogus>` → rejected.
- [ ] `/signin` with no/unlinked user → "You need to /link first."
- [ ] `/signin` with wrong code → backend "not today's code" message.
- [ ] `/signin` with correct code → success; a `[Timestamp, Name, Code]` row lands in the
      same `Sign-ins` tab; `Presence Matrix` shows `Present`, others `Absent`.
- [ ] Same user + same day again → "already signed in for today" (no duplicate row).
- [ ] Cross-channel: student signs in via the QR app, then `/signin` in the bot same day
      → rejected as already signed in (backend dedupe), and vice versa.
- [ ] With `SIGNIN_LOG_CHANNEL_ID` set → public message appears in that channel.
- [ ] Kill the network / set `APPS_SCRIPT_URL` to garbage → friendly error, bot stays up.
- [ ] Restart the Repl → links persist (`/status` still resolves).

## Failure modes and mitigations

| Problem | Mitigation |
|---|---|
| Backend returns 302 / empty response | `fetch` with `redirect:"follow"`; log raw text on parse failure to diagnose. |
| Command not appearing after invite | Reinvite with `applications.commands` scope; use `GUILD_ID` for instant guild registration. |
| Links lost on Replit reset | Keep store under `bot/data/`; document that a full project reset wipes links (re-`/link`). |
| Student not on roster | Backend rejects with clear message; add name to `Roster` tab (single source of truth). |
| Passcode wrong after midnight | Backend `passcode_date` check already rejects; message surfaced verbatim. |
| Bot offline at practice | Replit free tier sleep; recommend hosted deploy or keep a laptop fallback (web app still works). |

## Out of scope

- Admin bot commands (e.g., `/admin set-code`) — Config passcode stays a manual cell edit.
- Removing or replacing the GitHub Pages web app — it remains live as the QR sign-in path
  alongside the bot (students use one or the other, never both).
- Per-event / outreach attendance, hours tracking, reports — unchanged from the existing
  system's scope.
