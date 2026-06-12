# Step 3 Deploy Runbook — Invoice Snapshots + Previous Invoice

**Status: code complete and committed locally. NOTHING deployed.** Both prod
surfaces wait for Eugene's coordination window: (1) AppsScript backend redeploy,
(2) git push → GitHub Pages. Old client + new backend is fully compatible
(additive schema), so the order below never strands a user.

## What ships

- **Backend v2** (`Plans/AppsScript.gs`): new `invoices` sheet (one row per
  snapshot line, denormalized `cat_name`), `op:save_invoice` (append-only,
  per-customer `invoice_no`, same LockService), `last_invoice` on `op:load`,
  `schema_version` column (new saves stamp `2`; legacy rows read as `1`).
- **Client v1.15.0**: Invoice View still opens on a blank builder (unchanged
  default). New top-center **Previous Invoice** button — visible only when the
  loaded customer has a snapshot; toggles a read-only panel (never feeds the
  builder). **Print Invoice** now also snapshots the printed invoice
  (fire-and-forget; printing never waits on or fails because of the network;
  identical reprints dedupe per session).

## Deploy order (backend first — old clients ignore the new fields)

1. **Backup**: File → Make a copy of "LC Construction Budget — Customer
   Records" (timestamped name). This is the rollback for data.
2. Open the Sheet → Extensions → Apps Script → replace the entire script with
   `Plans/AppsScript.gs` (current main).
3. Run `setupSheet` once from the editor. Verify: `invoices` tab exists with
   bold headers; `customers` row 1 now ends with `schema_version`.
4. **Deploy → Manage deployments → ✏️ edit the EXISTING deployment → New
   version → Deploy.** Never "New deployment" — that changes the `/exec` URL
   and breaks every iPad bookmark.
5. Sanity probe (old client still live — this is safe):
   - `curl '<exec-url>?op=load&id=0001'` → response includes
     `"last_invoice":null` and `"schema_version":1` (or 2 after first save).
6. **Pause point** — old client + new backend can run indefinitely. Confirm
   normal save/load with users before proceeding.
7. `git push origin main` → wait for Pages (~90s) → verify live:
   `curl -s <pages-url> | grep -c prev-invoice-btn` ≥ 1, then Interceptor open.
8. **UAT on a real iPad** (with users on the line):
   - Load a customer → Invoice View → builder is BLANK (default unchanged).
   - Build a small invoice → Print Invoice → print dialog appears; after
     printing, status shows "Invoice #1 saved"; `invoices` tab has the rows.
   - Reload the page, load the same customer → "Previous Invoice" button
     visible → tap → read-only panel shows the printed invoice → tap again
     to hide. Builder still blank.
   - New Customer → button hidden.
   - Regression pass: type into cells, switch templates, print progress report.

## Rollback

- **Client**: `git revert <step-3 commit>` + push (Pages redeploys old client;
  it simply never calls `save_invoice` and ignores `last_invoice`).
- **Backend**: Manage deployments → edit existing → previous version. Snapshot
  data already written stays in the `invoices` tab (harmless either way).
- **Data**: the step-1 backup copy of the Sheet.

## Known limits (accepted)

- Only the LATEST snapshot is viewable in the UI (the sheet keeps all of them —
  a list view is a small future addition if Len wants it).
- Snapshot fires on Print Invoice only (the moment an invoice becomes real).
  Cmd+P native prints do NOT snapshot — the button is the paper trail.
