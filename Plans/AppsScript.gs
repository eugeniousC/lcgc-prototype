/**
 * LC General Contracting — Construction Budget Planner
 * Customer Records Backend (Google Apps Script)
 *
 * Endpoints (all return JSON):
 *   GET  ?op=list             → { customers: [{ id, description, updated_at, archived }, ...] }
 *   GET  ?op=load&id=0042     → full customer record (all fields + line_budgets + line_paid)
 *   POST {op:'save', ...}     → upsert; returns the saved record (with assigned id if new)
 *   POST {op:'archive', id}   → soft-delete (sets archived=true)
 *   POST {op:'restore', id}   → unarchive
 *
 * Setup:
 *   1. Open a Google Sheet (or run setupSheet() to bootstrap a fresh one)
 *   2. Extensions → Apps Script
 *   3. Paste this entire file
 *   4. Run `setupSheet` once (creates `customers` + `line_items` tabs if missing)
 *   5. Deploy → New deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   6. Copy the Web app URL into LC_Construction_Budget_Planner.html (CONFIG block)
 */

const SHEET_CUSTOMERS = 'customers';
const SHEET_LINE_ITEMS = 'line_items';
const NUM_LINES = 44;

const CUST_HEADERS = [
  'id', 'description', 'created_at', 'updated_at',
  'sqft', 'cost_per_sqft', 'base_build_budget', 'oop_pct', 'total_project_budget',
  'archived', 'template', 'last_billed_at',
];

// billed_oop = cumulative O&P billed on the line (durable, decrements Balance).
// oop_due = current-cycle O&P entered but not yet billed (cleared on Bill).
const LINE_HEADERS = ['customer_id', 'line_id', 'budget_dollars', 'paid_dollars', 'billed_oop', 'oop_due'];

// ─────────────────────────────────────────────────────────────────
// ONE-TIME SETUP
// ─────────────────────────────────────────────────────────────────
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let custs = ss.getSheetByName(SHEET_CUSTOMERS);
  if (!custs) {
    custs = ss.insertSheet(SHEET_CUSTOMERS);
    custs.appendRow(CUST_HEADERS);
    custs.getRange(1, 1, 1, CUST_HEADERS.length).setFontWeight('bold');
    custs.setFrozenRows(1);
  } else {
    // Idempotent header repair — rewrites row 1 to the current CUST_HEADERS so
    // re-running setup after a schema change (e.g. adding 'template') backfills
    // any new column header without disturbing existing data rows.
    custs.getRange(1, 1, 1, CUST_HEADERS.length).setValues([CUST_HEADERS]).setFontWeight('bold');
  }
  let lines = ss.getSheetByName(SHEET_LINE_ITEMS);
  if (!lines) {
    lines = ss.insertSheet(SHEET_LINE_ITEMS);
    lines.appendRow(LINE_HEADERS);
    lines.getRange(1, 1, 1, LINE_HEADERS.length).setFontWeight('bold');
    lines.setFrozenRows(1);
  } else {
    // Idempotent header repair — backfills new columns (billed_oop, oop_due)
    // when setup is re-run after a schema change, without touching data rows.
    lines.getRange(1, 1, 1, LINE_HEADERS.length).setValues([LINE_HEADERS]).setFontWeight('bold');
  }
  // Force ID columns to plain text so zero-padded ids ('0001') survive appendRow.
  // Without '@' format, Sheets coerces '0001' → number 1 and findCustomerRow_ fails on read.
  custs.getRange('A:A').setNumberFormat('@');
  lines.getRange('A:A').setNumberFormat('@');
  return 'Setup complete. Customer Records spreadsheet ready.';
}

// Wipe all customer + line_item data (keeps headers + formatting).
// Run from the editor when you need a clean slate during testing.
function wipeAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const custs = ss.getSheetByName(SHEET_CUSTOMERS);
  const lines = ss.getSheetByName(SHEET_LINE_ITEMS);
  if (custs && custs.getLastRow() > 1) {
    custs.getRange(2, 1, custs.getLastRow() - 1, CUST_HEADERS.length).clearContent();
  }
  if (lines && lines.getLastRow() > 1) {
    lines.getRange(2, 1, lines.getLastRow() - 1, LINE_HEADERS.length).clearContent();
  }
  return 'Wiped. Headers preserved.';
}

// ─────────────────────────────────────────────────────────────────
// HTTP ENTRY POINTS
// ─────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const op = (e.parameter.op || 'list').toLowerCase();
    if (op === 'list') return jsonOut({ customers: listCustomers() });
    if (op === 'load') {
      const id = padId_(e.parameter.id || '');
      if (!id) return jsonOut({ error: 'Missing id' }, 400);
      const record = loadCustomer(id);
      if (!record) return jsonOut({ error: 'Not found' }, 404);
      return jsonOut(record);
    }
    return jsonOut({ error: 'Unknown op: ' + op }, 400);
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const op = (body.op || 'save').toLowerCase();
    if (op === 'save') return jsonOut(saveCustomer(body));
    if (op === 'archive') {
      const id = padId_(body.id || '');
      if (!id) return jsonOut({ error: 'Missing id' }, 400);
      setArchived_(id, true);
      return jsonOut({ id: id, archived: true });
    }
    if (op === 'restore') {
      const id = padId_(body.id || '');
      if (!id) return jsonOut({ error: 'Missing id' }, 400);
      setArchived_(id, false);
      return jsonOut({ id: id, archived: false });
    }
    return jsonOut({ error: 'Unknown op: ' + op }, 400);
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────
function listCustomers() {
  const sheet = getCustomersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, CUST_HEADERS.length).getValues();
  const out = rows.map(rowToCustomerSummary_).filter(c => c !== null);
  // most-recently-updated first
  out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return out;
}

function rowToCustomerSummary_(row) {
  const id = padId_(row[0]);
  if (!id) return null;
  return {
    id: id,
    description: String(row[1] || ''),
    updated_at: row[3] ? new Date(row[3]).toISOString() : '',
    archived: !!row[9],
  };
}

// ─────────────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────────────
function loadCustomer(id) {
  const sheet = getCustomersSheet_();
  const rowIdx = findCustomerRow_(sheet, id);
  if (rowIdx < 0) return null;
  const row = sheet.getRange(rowIdx, 1, 1, CUST_HEADERS.length).getValues()[0];
  const summary = {
    id: padId_(row[0]),
    description: String(row[1] || ''),
    created_at: row[2] ? new Date(row[2]).toISOString() : '',
    updated_at: row[3] ? new Date(row[3]).toISOString() : '',
    sqft: Number(row[4] || 0),
    cost_per_sqft: Number(row[5] || 0),
    base_build_budget: Number(row[6] || 0),
    oop_pct: Number(row[7] || 0),
    total_project_budget: Number(row[8] || 0),
    archived: !!row[9],
    // Legacy rows (saved before the template column existed) read as '' → the
    // frontend's applyRecord falls back to 'conventional' for any unknown key.
    template: String(row[10] || ''),
    last_billed_at: row[11] ? String(row[11]) : '',
    line_budgets: new Array(NUM_LINES + 1).fill(0),  // 1-indexed
    line_paid: new Array(NUM_LINES + 1).fill(0),
    line_billed_oop: new Array(NUM_LINES + 1).fill(0),
    line_oop_due: new Array(NUM_LINES + 1).fill(0),
  };
  // pull line items for this customer
  const lineSheet = getLineItemsSheet_();
  const lLast = lineSheet.getLastRow();
  if (lLast >= 2) {
    const lineRows = lineSheet.getRange(2, 1, lLast - 1, LINE_HEADERS.length).getValues();
    const targetId = padId_(id);
    for (const lr of lineRows) {
      if (padId_(lr[0]) === targetId) {
        const lid = Number(lr[1]);
        if (lid >= 1 && lid <= NUM_LINES) {
          summary.line_budgets[lid] = Number(lr[2] || 0);
          summary.line_paid[lid] = Number(lr[3] || 0);
          summary.line_billed_oop[lid] = Number(lr[4] || 0);
          summary.line_oop_due[lid] = Number(lr[5] || 0);
        }
      }
    }
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────
// SAVE (upsert)
// ─────────────────────────────────────────────────────────────────
function saveCustomer(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);  // serialize concurrent saves so auto-ID is race-free
  try {
    const custSheet = getCustomersSheet_();
    const lineSheet = getLineItemsSheet_();
    const now = new Date().toISOString();

    let id = padId_(body.id || '');
    let rowIdx = id ? findCustomerRow_(custSheet, id) : -1;

    if (!id || rowIdx < 0) {
      // INSERT — assign next id
      id = nextId_(custSheet);
      const newRow = [
        id,
        String(body.description || ''),
        now,                                    // created_at
        now,                                    // updated_at
        Number(body.sqft || 0),
        Number(body.cost_per_sqft || 0),
        Number(body.base_build_budget || 0),
        Number(body.oop_pct || 0),
        Number(body.total_project_budget || 0),
        false,                                  // archived
        String(body.template || ''),            // template (build type)
        String(body.last_billed_at || ''),      // last_billed_at
      ];
      custSheet.appendRow(newRow);
      rowIdx = custSheet.getLastRow();
    } else {
      // UPDATE — preserve created_at + archived
      const existing = custSheet.getRange(rowIdx, 1, 1, CUST_HEADERS.length).getValues()[0];
      const updatedRow = [
        id,
        String(body.description != null ? body.description : existing[1]),
        existing[2] || now,                     // preserve created_at
        now,                                    // updated_at
        Number(body.sqft != null ? body.sqft : existing[4]),
        Number(body.cost_per_sqft != null ? body.cost_per_sqft : existing[5]),
        Number(body.base_build_budget != null ? body.base_build_budget : existing[6]),
        Number(body.oop_pct != null ? body.oop_pct : existing[7]),
        Number(body.total_project_budget != null ? body.total_project_budget : existing[8]),
        body.archived != null ? !!body.archived : !!existing[9],
        String(body.template != null ? body.template : (existing[10] || '')),
        String(body.last_billed_at != null ? body.last_billed_at : (existing[11] || '')),
      ];
      custSheet.getRange(rowIdx, 1, 1, CUST_HEADERS.length).setValues([updatedRow]);
    }

    // Replace this customer's line items
    if (Array.isArray(body.line_budgets) && Array.isArray(body.line_paid)) {
      // remove existing rows for this id
      const lLast = lineSheet.getLastRow();
      if (lLast >= 2) {
        const all = lineSheet.getRange(2, 1, lLast - 1, LINE_HEADERS.length).getValues();
        const kept = all.filter(r => padId_(r[0]) !== id);
        // clear and rewrite the kept rows
        lineSheet.getRange(2, 1, lLast - 1, LINE_HEADERS.length).clearContent();
        if (kept.length > 0) {
          lineSheet.getRange(2, 1, kept.length, LINE_HEADERS.length).setValues(kept);
        }
      }
      // append new rows for this customer
      const billedArr = Array.isArray(body.line_billed_oop) ? body.line_billed_oop : [];
      const dueArr = Array.isArray(body.line_oop_due) ? body.line_oop_due : [];
      const newLines = [];
      for (let i = 1; i <= NUM_LINES; i++) {
        newLines.push([
          id,
          i,
          Number(body.line_budgets[i] || 0),
          Number(body.line_paid[i] || 0),
          Number(billedArr[i] || 0),
          Number(dueArr[i] || 0),
        ]);
      }
      lineSheet.getRange(lineSheet.getLastRow() + 1, 1, NUM_LINES, LINE_HEADERS.length).setValues(newLines);
    }

    return loadCustomer(id);
  } finally {
    lock.releaseLock();
  }
}

function setArchived_(id, archived) {
  const sheet = getCustomersSheet_();
  const rowIdx = findCustomerRow_(sheet, id);
  if (rowIdx < 0) throw new Error('Customer not found: ' + id);
  sheet.getRange(rowIdx, 10).setValue(!!archived);
  sheet.getRange(rowIdx, 4).setValue(new Date().toISOString());
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function getCustomersSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CUSTOMERS);
  if (!sheet) throw new Error('customers sheet missing — run setupSheet() once.');
  return sheet;
}
function getLineItemsSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LINE_ITEMS);
  if (!sheet) throw new Error('line_items sheet missing — run setupSheet() once.');
  return sheet;
}

function findCustomerRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const target = padId_(id);
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    // Defensive: rows written before '@' format may store ids as numbers.
    // padId_ normalizes both sides so '1' and '0001' compare equal.
    if (padId_(ids[i][0]) === target) return i + 2;
  }
  return -1;
}

function nextId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '0001';
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxN = 0;
  for (const row of ids) {
    const n = parseInt(String(row[0] || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > maxN) maxN = n;
  }
  return padId_(String(maxN + 1));
}

function padId_(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

function jsonOut(obj, status) {
  // Apps Script ContentService can't set status codes, but we honor them in the payload for clients.
  if (status && status !== 200) obj.__status = status;
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
