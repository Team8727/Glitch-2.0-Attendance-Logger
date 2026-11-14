# Google Sheets reporting

PostgreSQL is the source of truth. Google Sheets is a **one-way report** for
mentors. The service pushes data to Sheets; it never reads roster data back.

## Tabs

**Sign-ins**

| Timestamp | Name | Code | Source |
|---|---|---|---|

`Source` is `discord`, `kiosk`, or `mentor`.

**Roster**

| First Name | Last Name | Subteam | PIN Set | Discord Linked | Discord ID |
|---|---|---|---|---|---|

The service fills `Subteam`, `PIN Set`, `Discord Linked`, and `Discord ID`.
Mentors only need to read this tab.

## 1. Create the sheet

Create a Google Sheet. The Apps Script will create both tabs and headers.

## 2. Add the Apps Script

1. Open the sheet → **Extensions → Apps Script**.
2. Replace the code with `service/google-apps-script/Code.gs`.
3. Set:
   - `SHEET_ID` — from the sheet URL
   - `SECRET` — the value of `SHEETS_WEBHOOK_SECRET` in `service/.env`
4. Save.

## 3. Deploy the web app

**Deploy → New deployment → Web app**

- Execute as: **Me**
- Who has access: **Anyone**

Copy the **Web app URL**.

## 4. Configure the service

In `service/.env`:

```bash
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
SHEETS_WEBHOOK_SECRET=<same secret as the Apps Script>
SHEETS_SYNC_INTERVAL_MS=60000
```

Restart:

```bash
systemctl --user restart glitch-attendance
```

## 5. Push member status

Dashboard → **Mentor force sign-in** → **Sync to Sheets**.

That writes the current members and their `Subteam`, `PIN Set`,
`Discord Linked`, and `Discord ID` to the `Roster` tab.

## 6. Attendance sync

New attendance rows are pushed automatically every 60 seconds. The Apps Script
dedupes by timestamp + name, so retries are safe.

## Notes

- Sync progress is stored in `service/data/sheet-sync.json`.
- To force a full attendance resync, delete `service/data/sheet-sync.json` and
  restart the service. The Apps Script skips rows that already exist.
- The webhook secret is the only protection on the Apps Script URL. Keep it
  private and rotate it if it leaks.
