# Glitch 2.0 Attendance — Discord Bot

Lets students sign in to attendance **from the team Discord**. It writes to the **same
Google Sheet** as the QR web app (`Sign-ins` tab), so the existing `Presence Matrix` and
`Season Summary` tabs keep working with no changes.

The QR code path stays live — students may use the QR code **or** the bot. Each student
uses one, never both. Both go through the same backend, which rejects a second sign-in
for the same person on the same day, so there are no duplicate rows either way.

```
Discord /signin ─┐
                 ├─► Google Apps Script backend (same URL as site/) ─► Google Sheet 'Sign-ins'
QR web app ──────┘      (passcode check + "already signed in today" dedupe)
```

## Flow for a student

1. Once: run `/link <your roster name>` — the bot checks the name against the roster and
   binds it to your Discord account (stored in `bot/data/links.json`).
2. Every practice: run `/signin <today's code>`. The code is posted in Discord / on the
   whiteboard, same as before.
3. `/status` shows which roster name you're linked to.

All bot replies are ephemeral (only you see them). If `SIGNIN_LOG_CHANNEL_ID` is set, a
public "**Name** signed in." message appears in that channel after each sign-in.

## Repo layout

- `bot/package.json` — dependencies (discord.js v14; Node 18+).
- `bot/index.js` — the bot: command registration, `/link` `/signin` `/status`, and the
  fetch calls to the Apps Script backend.
- `bot/store.js` — saves the Discord-ID → roster-name links in `bot/data/links.json`.
- `bot/.env.example` — documents every config value (copy to `.env` locally, or use
  Replit Secrets).
- `.replit` (repo root) — tells Replit to run the bot from `bot/`.

---

# Part A — Create the Discord application

1. Go to https://discord.com/developers/applications and sign in.
2. **New Application** → name it (e.g. `Glitch Attendance`) → **Create**.
3. **General Information**: copy the **Application ID** — this is `CLIENT_ID`.
4. Left menu → **Bot** → **Add Bot** → **Reset Token** → copy the token — this is
   `DISCORD_TOKEN`. Keep it secret; anyone with it can control the bot.
5. Left menu → **OAuth2 → URL Generator**:
   - **Scopes**: check `bot` and `applications.commands`.
   - **Bot permissions**: `Send Messages`, `Embed Links`, `View Channels`,
     `Read Message History`.
   - Copy the generated **URL** at the bottom and open it in a browser. Pick your team
     server → **Authorize**. (You need "Manage Server" to invite bots.)
6. Get your server ID: Discord → **User Settings → Advanced → enable Developer Mode**,
   then right-click your server name → **Copy Server ID** — this is `GUILD_ID`
   (optional, but makes commands appear instantly).

You do **not** need any privileged Gateway intents — slash commands only.

---

# Part B — Set up on Replit

1. Go to https://replit.com and create/log in to an account.
2. Click **Create** (top-left) → **Import from GitHub**.
3. Paste this repository's URL and import it. Replit clones the repo and reads the
   `.replit` file, which already points the Run button at the bot:
   ```
   run = "cd bot && npm install && npm start"
   ```
   The first run installs dependencies automatically.
4. Add your secrets (the environment variables):
   - Left sidebar → **Tools** → **Secrets** (or the **padlock / key** icon in the left
     panel; it may be labelled "Secrets" in newer UI).
   - Add each value from `bot/.env.example`:
     - `DISCORD_TOKEN` — from Part A step 4.
     - `CLIENT_ID` — from Part A step 3.
     - `GUILD_ID` — from Part A step 6 (recommended).
     - `APPS_SCRIPT_URL` — the **same `/exec` URL** already used in `site/config.js`.
       If you haven't deployed the backend yet, follow `backend/README.md` first.
     - `SIGNIN_LOG_CHANNEL_ID` — optional. Right-click the channel you want public
       "signed in" messages in → Copy Channel ID (Developer Mode must be on).
5. Press **Run**. You should see:
   ```
   [startup] Registered 3 commands (...).
   [startup] Backend reachable — roster has N members.
   [bot] Logged in as Glitch Attendance#0000.
   ```
6. Back in Discord, the `/link`, `/signin`, and `/status` commands should appear within a
   few seconds.

### Keeping the bot online

- A Discord bot holds an active connection, which keeps a free Replit Repl from sleeping
  in normal use.
- If the Repl does go idle and the bot drops, open the Repl and press **Run** again, or
  deploy it as a hosted/autoscale Repl (Replit's "Deploy" feature) for always-on.
- `/link` data lives in `bot/data/links.json` on Replit's persistent disk, so it survives
  restarts. A full project **reset/delete** wipes it — students would re-run `/link`.

---

# Part C — Local testing (optional, on any computer)

```
cd bot
cp .env.example .env        # fill in the values
npm install
npm start
```

---

# Adding / changing roster members

Edit the **Roster** tab of the spreadsheet — that's the single source of truth. The bot
fetches the roster from the backend on every `/link`, so new names are available
immediately (no bot restart needed).

# Practice day routine (mentors)

Nothing new: update the `Config` tab `passcode` + `passcode_date` before practice, and
post the code in Discord as usual (students need it for `/signin`).

---

# Verification checklist

- [ ] Invite the bot to the server (Part A step 5) and it appears online.
- [ ] `/link <your roster name>` → ephemeral confirmation with your linked name.
- [ ] `/link <garbage>` → rejected with "isn't on the roster".
- [ ] `/signin` before linking → "You're not linked yet".
- [ ] `/signin` with a wrong code → the backend's "not today's code" message.
- [ ] `/signin` with the correct code → success; a `[Timestamp, Name, Code]` row lands in
      the **`Sign-ins`** tab; `Presence Matrix` shows `Present`.
- [ ] Same user, same day, again → "already signed in for today" (no duplicate row) —
      including if they already signed in via the QR code.
- [ ] With `SIGNIN_LOG_CHANNEL_ID` set → a public message appears in that channel.
- [ ] Restart the Repl → `/status` still shows your link (persisted).
- [ ] Set `APPS_SCRIPT_URL` to a bad URL → `/signin` gives a friendly error, bot stays up.

# Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variables` at startup | Add `DISCORD_TOKEN`, `CLIENT_ID`, `APPS_SCRIPT_URL` (and `GUILD_ID`) as Replit Secrets and restart. |
| Commands don't show up | The invite URL must include `applications.commands` scope (Part A step 5). With `GUILD_ID` set, guild commands appear almost instantly; global commands can take up to an hour. |
| `Backend not reachable` at startup | Double-check `APPS_SCRIPT_URL` is the `/exec` URL from a deployed web app with access **Anyone**. Re-deploy if you changed `Code.gs` and update the URL. |
| `"name" isn't on the roster` | The name must match the `Roster` tab exactly (case-insensitive). Add new members there. |
| Sign-in says already signed in, but student says they didn't | They (or someone using their name) already signed in via the QR app or the bot today — the backend's per-day dedupe is intentional. |
| Bot drops offline during a practice | Reopen the Repl and Run, or use Replit's hosted deployment for always-on. |
| Replit reset wiped `/link` data | Re-run `/link` (each student once). |
