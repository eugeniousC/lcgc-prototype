# LC Planner Persistence — Setup Guide

> **Audience:** Eugene (initial setup), then later Len when migrating to his Workspace.
> **Time:** ~15 minutes end-to-end.
> **Stack:** Google Sheets + Apps Script (no servers, no hosting, no payment).

---

## Step 1 — Create the spreadsheet (1 min)

1. Go to https://sheets.google.com
2. Click the big blank `+` to create a new spreadsheet
3. Rename it: **LC Construction Budget — Customer Records**
4. Leave Sheet1 alone — the Apps Script will create the right sheets automatically

---

## Step 2 — Add the Apps Script backend (3 min)

1. In the spreadsheet, click **Extensions → Apps Script** (top menu bar)
2. A new tab opens with a code editor showing `function myFunction() { ... }`
3. **Delete everything** in that editor
4. Open `/Users/ecoleman/Projects/LCGC/Plans/AppsScript.gs` on your Mac
5. Copy the entire file contents
6. Paste into the Apps Script editor
7. Click the floppy-disk **Save** icon (or `Cmd+S`)
8. At the top, the project might be named "Untitled project" — rename it to "LC Planner Backend"

---

## Step 3 — Bootstrap the sheet structure (1 min)

1. Still in the Apps Script editor
2. At the top there's a dropdown showing function names — select **setupSheet**
3. Click the ▶ **Run** button next to it
4. **First time only:** Google asks for permissions
   - Click "Review permissions"
   - Pick your Google account
   - You'll see **"Google hasn't verified this app"** — this is expected for personal scripts
   - Click **"Advanced"** at the bottom left
   - Click **"Go to LC Planner Backend (unsafe)"** — it's safe; the "unsafe" label just means you haven't submitted it for Google's formal review
   - Click **"Allow"** on the permissions request
5. The function runs; you should see "Setup complete" in the execution log at the bottom
6. Switch back to the spreadsheet tab — you'll see two new sheets at the bottom: **customers** and **line_items**, each with a header row

---

## Step 4 — Deploy as a web app (3 min)

1. Back in the Apps Script editor
2. Click the **Deploy** button (top-right) → **New deployment**
3. Click the gear ⚙ icon next to "Select type" → choose **Web app**
4. Fill in:
   - **Description:** `LC Planner v1`
   - **Execute as:** **Me** (`your-email@gmail.com`)
   - **Who has access:** **Anyone**
     (This sounds scary, but the URL is long and obscure. For Len's data this is fine; we can tighten later.)
5. Click **Deploy**
6. Google asks for permissions again (same flow as Step 3 if it appears)
7. You'll see a confirmation screen with a **Web app URL** — looks like:
   ```
   https://script.google.com/macros/s/AKfycby...long-id.../exec
   ```
8. **Copy that URL** — this is what the planner needs

---

## Step 5 — Connect the planner (1 min)

1. Open https://eugeniousc.github.io/lcgc-prototype/LC_Construction_Budget_Planner.html in Chrome
2. At the top, an amber banner says **"Connect your Customer Records spreadsheet to save jobs"**
3. Paste your Apps Script web app URL into the input
4. Click **Connect**
5. The banner disappears; the customer picker says "+ New Customer"
6. Status indicator on the right reads **"Ready · select or create"**

---

## Step 6 — End-to-end test (5 min)

1. The picker is on "+ New Customer"
2. Type a description: **"TEST RECORD"**
3. Optionally edit any numbers (sqft, paid amounts, anything)
4. Click **Save**
5. The status flips to **"Saved · [time] · 0001"** — you just created your first customer record with auto-ID `0001`
6. Switch the dropdown to "+ New Customer" — the form resets
7. Switch back to "0001 — TEST RECORD" — your data reloads exactly as you left it
8. Open the spreadsheet in another tab
9. Look at the `customers` sheet — row 2 has your record
10. Look at the `line_items` sheet — 44 rows tagged with `customer_id = 0001`

If all of that works: **persistence is live**.

---

## Step 7 — Make it your own data (optional)

- Open the spreadsheet directly any time to see all your customer records as a list
- You can hand-edit fields in the sheet — next time you load that customer, edits flow into the planner
- You can share the sheet with anyone (e.g. Len's bookkeeper) just like any Google Sheet

---

## Migrating to Len's Workspace (later)

Once you've tested everything and want to hand it to Len:

1. **Option A — Transfer ownership of the sheet to Len.**
   - In your sheet: **Share → Add Len as Editor → "Transfer ownership" → Make Len the owner**
   - Len opens it, re-runs `setupSheet` is *not* needed (already done)
   - Len redeploys the Apps Script *under his account* (the existing deployment runs as you; he needs a new one running as him so quota and access live in his Workspace)
   - Len copies the new URL, pastes into the planner's setup banner
   - Eugene removes the local URL config (or keeps it pointing at his own copy for testing)

2. **Option B — Len creates his own sheet from scratch.**
   - Walk Len through Steps 1-5 above in his own Google account
   - Both Eugenes-test-copy and Len's-real-copy can exist in parallel forever

I recommend Option A — single sheet, ownership transferred, less divergence.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Banner won't go away after pasting URL | URL must start with `https://script.google.com/` — make sure you copied the full deployment URL, not the editor URL. |
| "Save failed — kept locally" | Apps Script returned an error. Open the script editor → View → Executions tab → see the failure message. Most common cause: setup never ran (you'd see "customers sheet missing"). |
| "Google hasn't verified this app" can't be bypassed | You're on a managed Workspace that disables unverified scripts. Either request your admin to allow it, or move to a personal Google account for testing. |
| Customer dropdown is empty after Connect | Likely the URL points at a deployment that ran setup against a different sheet. Re-deploy from the spreadsheet that has the customers + line_items tabs. |
| Edits aren't auto-saving | Auto-save only triggers when a customer record is already selected (has an ID). New customers must be Saved manually the first time. |

---

## What the planner does locally if Apps Script is down

- Planner keeps working as a standalone tool — no errors, no data loss
- The current customer's edits are mirrored to `localStorage` on every change
- Status indicator shows the failure
- Next successful Save flushes localStorage to Apps Script

Refresh the page mid-outage and your work is still there.
