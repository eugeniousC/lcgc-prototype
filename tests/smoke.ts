// Smoke harness — step 0 of the in-place fix plan.
// Boots LC_Construction_Budget_Planner.html offline, drives all 4 templates and
// both print modes, and compares a structural golden master: row counts, phase
// cards, totals, print-container contents, body classes.
//
//   bun tests/smoke.ts            # compare against tests/golden/smoke.golden.json
//   bun tests/smoke.ts --update   # regenerate the golden master
//
// Execution model: happy-dom under Bun does not evaluate inline <script> tags
// (Bun vm limitation), so we register happy-dom globals (GlobalRegistrator),
// parse the HTML, then run the extracted inline script via vm.runInThisContext —
// top-level function declarations (applyTemplate, setActiveTab, ...) land on
// globalThis exactly as they would on window in a real browser.
//
// Golden master asserts CONTAINER CONTENT + CLASS TOGGLES, not CSS visibility —
// happy-dom doesn't evaluate @media print, and the v1.12.x "invoice print leaked
// all categories" bug class shows up as content in the wrong container anyway.
// Volatile fields (dates, print titles) are deliberately not captured.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";

const ROOT = resolve(dirname(import.meta.path), "..");
const PLANNER = resolve(ROOT, "LC_Construction_Budget_Planner.html");
const GOLDEN = resolve(ROOT, "tests/golden/smoke.golden.json");
const UPDATE = process.argv.includes("--update");
const started = Date.now();

// Expected per-template structure (mirrors the TEMPLATES registry).
const EXPECTED = {
  barndo: { lines: 24, phases: 7 },
  conventional: { lines: 44, phases: 7 },
  remodel: { lines: 14, phases: 1 },
  commercial: { lines: 42, phases: 7 },
} as const;
type TemplateKey = keyof typeof EXPECTED;
type FetchLogEntry = { url: string; method: string; op: string; body: any };

const errors: string[] = [];
const fetchLog: FetchLogEntry[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) errors.push(msg);
}

function makeLoadRecord() {
  const lineBudgets = new Array(45).fill(0);
  const linePaid = new Array(45).fill(0);
  lineBudgets[1] = 50_000;
  lineBudgets[2] = 30_000;
  linePaid[1] = 5_000;
  return {
    id: "0042",
    description: "Forge Test Customer",
    template: "barndo",
    sqft: 1583,
    cost_per_sqft: 180,
    base_build_budget: 284_940,
    oop_pct: 15,
    managed_by: "Len",
    line_budgets: lineBudgets,
    line_paid: linePaid,
    archived: false,
    last_invoice: {
      invoice_no: 3,
      created_at: "2026-06-01T00:00:00.000Z",
      managed_by: "Len",
      oop_pct: 15,
      lines: [
        {
          cat: 1,
          name: "Clearing & Grading",
          vendor: "Chris Easterwood",
          check: 5000,
          cash: 0,
          paid: 5000,
        },
      ],
    },
  };
}

function okJson(payload: any) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

// ── Boot ────────────────────────────────────────────────────────────
GlobalRegistrator.register({ url: "https://localhost/planner.html" });

localStorage.setItem("lcgc_appsscript_url", "https://script.google.com/macros/s/STUB/exec");

// Offline recorder: persistence is configured up front, so boot runs the real
// list/load/save code paths against a deterministic in-memory transport.
const fetchRecorder = async (input: string | URL | { url?: string }, init?: { method?: string; body?: string }) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input.url ?? input);
  const method = (init?.method ?? "GET").toUpperCase();
  let op = "";
  let body: any = null;
  let payload: any;

  if (method === "GET") {
    const params = new URL(url).searchParams;
    op = params.get("op") ?? "";
    body = Object.fromEntries(params.entries());
    fetchLog.push({ url, method, op, body });
    if (op === "list") payload = { customers: [] };
    else if (op === "load") {
      if (params.get("id") !== "0042") throw new Error(`unexpected load id: ${params.get("id")}`);
      payload = makeLoadRecord();
    } else {
      throw new Error("unexpected op: " + op);
    }
    return okJson(payload);
  }

  if (method === "POST") {
    body = init?.body ? JSON.parse(init.body) : null;
    op = String(body?.op ?? "");
    fetchLog.push({ url, method, op, body });
    if (op === "save") payload = { ...body, id: body?.id || "0042" };
    else if (op === "save_invoice") {
      payload = { id: "0042", invoice_no: 4, created_at: "2026-06-01T00:00:00.000Z", line_count: 1 };
    } else if (op === "archive" || op === "restore") payload = { ok: true };
    else throw new Error("unexpected op: " + op);
    return okJson(payload);
  }

  throw new Error("unexpected method: " + method);
};
(globalThis as any).fetch = fetchRecorder;
(globalThis as any).confirm = () => true;
(globalThis as any).alert = () => {};
(globalThis as any).print = () => {};
(window as any).fetch = fetchRecorder;
(window as any).confirm = (globalThis as any).confirm;
(window as any).alert = (globalThis as any).alert;
(window as any).print = (globalThis as any).print;

const html = readFileSync(PLANNER, "utf8")
  .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>\s*/gi, "")
  .replace(/<link[^>]+fonts\.gstatic\.com[^>]*>\s*/gi, "");
document.write(html);
(window as any).fetch = fetchRecorder;
(window as any).confirm = (globalThis as any).confirm;
(window as any).alert = (globalThis as any).alert;
(window as any).print = (globalThis as any).print;

const inline = document.querySelector("script")?.textContent ?? "";
check(inline.length > 50_000, `boot: inline script looks truncated (${inline.length} chars)`);

try {
  vm.runInThisContext(inline, { filename: "planner-inline.js" });
} catch (e: any) {
  console.error("SMOKE FAIL: planner script threw during boot:", e?.stack || e);
  process.exit(1);
}

const g = globalThis as any;
check(typeof g.applyTemplate === "function", "boot: applyTemplate not global");
check(typeof g.setActiveTab === "function", "boot: setActiveTab not global");
check(typeof g.loadCustomerById === "function", "boot: loadCustomerById not global");

// ── Capture helpers ─────────────────────────────────────────────────
const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => document.querySelectorAll(sel);
const text = (sel: string) => ($(sel)?.textContent || "").replace(/\s+/g, " ").trim();

async function settleAsyncWork(delayMs = 5) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function snapshotTemplate(key: TemplateKey) {
  g.applyTemplate(key);
  const rows = $$("#rows .line-row").length;
  const categoryHeaders = $$("#rows .category-row").length;
  const phaseCards = $$("#phases-grid .phase-card").length;
  check(rows === EXPECTED[key].lines, `${key}: rendered rows ${rows} != ${EXPECTED[key].lines}`);
  check(phaseCards === EXPECTED[key].phases, `${key}: phase cards ${phaseCards} != ${EXPECTED[key].phases}`);
  return {
    rows,
    categoryHeaders,
    phaseCards,
    invoiceBuilderRows: $$("#invoice-rows .line-row").length,
    totalInput: ($("#total-input") as any)?.value ?? null,
    budgetInput: ($("#budget-input") as any)?.value ?? null,
    summaryStrip: text(".summary-strip"),
    bodyTemplateClasses: [...document.body.classList].filter((c) => c.startsWith("tpl-")).sort(),
  };
}

function snapshotPrint(mode: "progress" | "invoice") {
  // Native-print path: mode resolves from the active tab inside beforeprint.
  g.setActiveTab(mode === "invoice" ? "invoice" : "bank");
  window.dispatchEvent(new Event("beforeprint"));
  const prRows = $$("#pr-tbody tr").length;
  const invRows = $$("#inv-print-tbody tr").length;
  const printingInvoice = document.body.classList.contains("printing-invoice");
  // Content signature of the ACTIVE doc — first row + footer totals. Catches
  // builder content regressions (wrong numbers, wrong columns), not just
  // count/class regressions. Both are deterministic: no dates live in
  // tbody/tfoot (the print date goes to a separate header element).
  const activeBody = mode === "invoice" ? "#inv-print-tbody" : "#pr-tbody";
  const activeFoot = mode === "invoice" ? "#inv-print-tfoot" : "#pr-tfoot";
  const firstRow = ($(activeBody + " tr:first-child")?.textContent || "").replace(/\s+/g, " ").trim();
  const footer = text(activeFoot);
  if (mode === "invoice") {
    check(printingInvoice, "invoice print: body missing printing-invoice class");
    check(prRows === 0, `invoice print: progress doc not emptied (${prRows} rows leaked)`);
  } else {
    check(!printingInvoice, "progress print: printing-invoice class leaked");
    check(invRows === 0, `progress print: invoice doc not emptied (${invRows} rows leaked)`);
    check(prRows > 0, "progress print: pr-tbody is empty");
  }
  window.dispatchEvent(new Event("afterprint"));
  return { prRows, invRows, printingInvoice, firstRow, footer };
}

function snapshotBankDrawEntry() {
  g.applyTemplate("barndo");
  const firstLineId = $("#rows .line-row[data-id]")?.getAttribute("data-id") ?? null;
  check(firstLineId === "1", `bank draw: expected first barndo line id 1, got ${JSON.stringify(firstLineId)}`);

  const paidSelector = `#rows .line-row[data-id="${firstLineId}"] input[data-kind="paid"]`;
  const paidInput = $(paidSelector) as HTMLInputElement | null;
  check(!!paidInput, `bank draw: missing paid input for selector ${paidSelector}`);
  check(text("#paid-value") === "$0.00", `bank draw: expected clean Total Paid baseline, got ${text("#paid-value")}`);

  if (paidInput) {
    paidInput.value = "5000";
    paidInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const paidValue = text("#paid-value");
  const summaryStrip = text(".summary-strip");
  check(paidValue === "$5,750.00", `bank draw: Total Paid should be $5,750.00, got ${paidValue}`);
  check(summaryStrip.includes("Total Paid $5,750.00"), `bank draw: summary strip missing updated paid total (${summaryStrip})`);
  check(!summaryStrip.includes("Total Paid $0.00"), `bank draw: summary strip still shows zero paid (${summaryStrip})`);

  return {
    lineId: firstLineId,
    paidSelector,
    paidValue,
    summaryStrip,
  };
}

function snapshotInvoiceBuilderEntry() {
  g.applyTemplate("barndo");
  const builderRowsBefore = $$("#invoice-rows .line-row").length;
  check(builderRowsBefore === 1, `invoice builder: expected one blank row before commit, got ${builderRowsBefore}`);
  check(text("#paid-value") === "$0.00", `invoice builder: expected clean Total Paid baseline, got ${text("#paid-value")}`);

  const phaseSelector = "#invoice-rows .inv-new-row select.phase-select";
  const phaseSelect = $(phaseSelector) as HTMLSelectElement | null;
  check(!!phaseSelect, `invoice builder: missing new-row phase select ${phaseSelector}`);

  const firstPhaseValue =
    [...(phaseSelect?.options ?? [])].map((option) => option.value).find((value) => value !== "") ?? null;
  check(firstPhaseValue === "1", `invoice builder: expected first phase option 1, got ${JSON.stringify(firstPhaseValue)}`);

  if (phaseSelect && firstPhaseValue) {
    phaseSelect.value = firstPhaseValue;
    phaseSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const builderRowsAfterCommit = $$("#invoice-rows .line-row").length;
  const committedRows = $$("#invoice-rows .line-row:not(.inv-new-row)").length;
  check(builderRowsAfterCommit === 2, `invoice builder: expected committed row + blank row, got ${builderRowsAfterCommit}`);
  check(committedRows === 1, `invoice builder: expected one committed row, got ${committedRows}`);

  const committedRow = $("#invoice-rows .line-row:not(.inv-new-row)");
  check(!!committedRow, "invoice builder: committed row missing after phase change");
  const checkSelector = "#invoice-rows .line-row:not(.inv-new-row) input[data-kind=\"check\"]";
  const checkInput = committedRow?.querySelector('input[data-kind="check"]') as HTMLInputElement | null;
  check(!!checkInput, `invoice builder: missing check input ${checkSelector}`);

  if (checkInput) {
    checkInput.value = "2500";
    checkInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const paidValue = text("#paid-value");
  const summaryStrip = text(".summary-strip");
  check(paidValue === "$2,875.00", `invoice builder: Total Paid should be $2,875.00, got ${paidValue}`);
  check(summaryStrip.includes("Total Paid $2,875.00"), `invoice builder: summary strip missing rolled-up paid total (${summaryStrip})`);

  g.setActiveTab("invoice");
  window.dispatchEvent(new Event("beforeprint"));
  const invoicePrintRows = $$("#inv-print-tbody tr").length;
  check(invoicePrintRows === 1, `invoice builder: invoice print should show one paid row, got ${invoicePrintRows}`);
  window.dispatchEvent(new Event("afterprint"));

  return {
    builderRowsBefore,
    builderRowsAfterCommit,
    committedRows,
    phaseSelector,
    selectedPhase: firstPhaseValue,
    checkSelector,
    invoicePrintRows,
    paidValue,
    summaryStrip,
  };
}

function snapshotValueSyncIntegrity() {
  g.applyTemplate("barndo");
  const sel = '#rows .line-row[data-id="1"] input[data-kind="paid"]';
  const ref = $(sel) as HTMLInputElement | null;
  check(!!ref, `value sync: missing paid input for selector ${sel}`);

  if (!ref) {
    return {
      sel,
      connected: false,
      nodeIdentityStable: false,
      activeElementMatched: false,
      valueAfterFirst: null,
      valueAfterSecond: null,
      oop: "",
      actualPct: "",
      oop2: "",
      actualPct2: "",
    };
  }

  ref.focus();
  const activeElementMatchedOnFocus = document.activeElement === ref;

  ref.value = "7500";
  ref.dispatchEvent(new Event("input", { bubbles: true }));

  const currentAfterFirst = document.querySelector(sel) as HTMLInputElement | null;
  const activeElementMatched = document.activeElement === ref;
  const oop = text('#rows .line-row[data-id="1"] .col-oop');
  const actualPct = text('#rows .line-row[data-id="1"] .col-actualpct');

  check(ref.isConnected === true, `value sync: paid input disconnected after first input (isConnected=${ref.isConnected})`);
  check(
    currentAfterFirst === ref,
    `value sync: node identity changed after first input — repaint recreated the input (sameNode=${currentAfterFirst === ref}, currentValue=${JSON.stringify(currentAfterFirst?.value ?? null)})`
  );
  if (activeElementMatchedOnFocus) {
    check(
      activeElementMatched,
      `value sync: focus moved after first input (activeElementMatched=${activeElementMatched}, activeTag=${JSON.stringify(document.activeElement?.tagName ?? null)})`
    );
  }
  check(ref.value === "7500", `value sync: first input value was clobbered, got ${JSON.stringify(ref.value)}`);
  check(oop.length > 0, `value sync: row 1 oop cell stayed empty after first input, got ${JSON.stringify(oop)}`);
  check(actualPct.length > 0, `value sync: row 1 actual pct cell stayed empty after first input, got ${JSON.stringify(actualPct)}`);

  ref.value = "75000";
  ref.dispatchEvent(new Event("input", { bubbles: true }));

  const currentAfterSecond = document.querySelector(sel) as HTMLInputElement | null;
  const oop2 = text('#rows .line-row[data-id="1"] .col-oop');
  const actualPct2 = text('#rows .line-row[data-id="1"] .col-actualpct');

  check(ref.isConnected === true, `value sync: paid input disconnected after second input (isConnected=${ref.isConnected})`);
  check(
    currentAfterSecond === ref,
    `value sync: node identity changed after second input — repaint recreated the input (sameNode=${currentAfterSecond === ref}, currentValue=${JSON.stringify(currentAfterSecond?.value ?? null)})`
  );
  check(ref.value === "75000", `value sync: second input value was clobbered, got ${JSON.stringify(ref.value)}`);

  return {
    sel,
    connected: ref.isConnected,
    nodeIdentityStable: currentAfterFirst === ref && currentAfterSecond === ref,
    activeElementMatched,
    valueAfterFirst: "7500",
    valueAfterSecond: "75000",
    oop,
    actualPct,
    oop2,
    actualPct2,
  };
}

// Empirically fire every consolidated update() trigger the earlier sections
// don't already cover (covered elsewhere: onCellInput, onInvoicePhaseChange,
// onInvoiceCellInput, applyTemplate, init; deferred to step-3 work:
// applyRecord/startNewCustomer — persistence-coupled; onInvoiceVendorChange
// paints nothing). Triggers here: oopSlider, onBudgetInput, onTotalInput,
// applySqftChange, armOnce reset. Plus a caret-preservation soft probe.
function snapshotCascadeTriggers() {
  g.applyTemplate("barndo");
  const fire = (el: HTMLInputElement, val: string) => {
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const out: Record<string, unknown> = {};

  fire($("#oop-slider") as HTMLInputElement, "20");
  out.afterOopSlider = `${text("#oop-value")} | total ${($("#total-input") as HTMLInputElement).value}`;
  check(text("#oop-pct-display") === "at 20.0%", `cascade oopSlider: O&P display not repainted (${text("#oop-pct-display")})`);

  fire($("#budget-input") as HTMLInputElement, "300000");
  out.afterBudgetInput = `total ${($("#total-input") as HTMLInputElement).value}`;
  check(($("#total-input") as HTMLInputElement).value === "360,000.00",
    `cascade onBudgetInput: total not repainted from 300000 @ 20% (${($("#total-input") as HTMLInputElement).value})`);

  fire($("#total-input") as HTMLInputElement, "240000");
  out.afterTotalInput = `budget ${($("#budget-input") as HTMLInputElement).value}`;
  check(($("#budget-input") as HTMLInputElement).value === "200,000.00",
    `cascade onTotalInput: base not back-computed from 240000 @ 20% (${($("#budget-input") as HTMLInputElement).value})`);

  fire($("#sqft-input") as HTMLInputElement, "2000");
  out.afterSqft = `budget ${($("#budget-input") as HTMLInputElement).value}`;

  // Caret preservation: focused paid input mid-edit must keep value AND caret
  // across a full update(). happy-dom may not model selection — soft-capture,
  // hard-check the value.
  const paid = $('#rows .line-row[data-id="2"] input[data-kind="paid"]') as HTMLInputElement;
  paid.focus();
  fire(paid, "1234");
  let caret: string = "unsupported";
  try {
    paid.setSelectionRange(2, 2);
    g.update();
    caret = `${paid.selectionStart},${paid.selectionEnd}`;
  } catch (_) {
    g.update();
  }
  check(paid.value === "1234", `cascade caret probe: focused value clobbered by update() (${paid.value})`);
  out.caretAfterUpdate = caret;

  // armOnce reset (two clicks: arm, then fire) → applyDefaults + renderRows + update
  const resetBtn = $("#reset-btn") as HTMLButtonElement;
  resetBtn.click();
  resetBtn.click();
  out.afterReset = `budget ${($("#budget-input") as HTMLInputElement).value} | paid ${text("#paid-value")}`;
  return out;
}

async function snapshotPreviousInvoice() {
  await settleAsyncWork();
  await g.loadCustomerById("0042");

  const prevButtonSelector = "#prev-invoice-btn";
  const prevButton = $(prevButtonSelector) as HTMLButtonElement | null;
  check(!!prevButton, `previous invoice: missing button ${prevButtonSelector}`);

  const btnHiddenAfterLoad = prevButton?.classList.contains("hidden") ?? true;
  check(!btnHiddenAfterLoad, "previous invoice: button stayed hidden after loading record 0042");

  const builderRows = $$("#invoice-rows .line-row").length;
  check(builderRows === 1, `previous invoice: builder should stay blank after load, got ${builderRows} rows`);

  prevButton?.click();
  const panelVisibleAfterFirstClick = !($("#prev-invoice-panel")?.classList.contains("hidden") ?? true);
  check(panelVisibleAfterFirstClick, "previous invoice: panel stayed hidden after first toggle");

  const tbodyRows = $$("#prev-invoice-tbody tr").length;
  check(tbodyRows === 1, `previous invoice: expected 1 history row, got ${tbodyRows}`);

  const rowText = text("#prev-invoice-tbody tr:first-child");
  check(
    rowText.includes("Clearing & Grading") && rowText.includes("$5,000.00"),
    `previous invoice: first row text missing expected name/amount (${rowText})`
  );

  const metaHasManagedBy = text("#prev-invoice-meta").includes("Managed by Len");
  check(metaHasManagedBy, `previous invoice: meta missing managed-by text (${text("#prev-invoice-meta")})`);

  prevButton?.click();
  const panelHiddenAfterSecondClick = $("#prev-invoice-panel")?.classList.contains("hidden") ?? false;
  check(panelHiddenAfterSecondClick, "previous invoice: panel stayed visible after second toggle");

  return {
    btnHiddenAfterLoad,
    builderRows,
    panelVisibleAfterFirstClick,
    tbodyRows,
    firstRowText: rowText,
    metaHasManagedBy,
    panelHiddenAfterSecondClick,
  };
}

async function snapshotPrintInvoiceSave() {
  const builderRowsBefore = $$("#invoice-rows .line-row").length;
  check(builderRowsBefore === 1, `print invoice save: expected one blank builder row before commit, got ${builderRowsBefore}`);

  const phaseSelector = "#invoice-rows .inv-new-row select.phase-select";
  const phaseSelect = $(phaseSelector) as HTMLSelectElement | null;
  check(!!phaseSelect, `print invoice save: missing new-row phase select ${phaseSelector}`);

  const firstPhaseValue =
    [...(phaseSelect?.options ?? [])].map((option) => option.value).find((value) => value !== "") ?? null;
  check(firstPhaseValue === "1", `print invoice save: expected first phase option 1, got ${JSON.stringify(firstPhaseValue)}`);

  if (phaseSelect && firstPhaseValue) {
    phaseSelect.value = firstPhaseValue;
    phaseSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const committedRows = $$("#invoice-rows .line-row:not(.inv-new-row)").length;
  check(committedRows === 1, `print invoice save: expected one committed row after phase change, got ${committedRows}`);

  const checkSelector = '#invoice-rows .line-row:not(.inv-new-row) input[data-kind="check"]';
  const checkInput = $(checkSelector) as HTMLInputElement | null;
  check(!!checkInput, `print invoice save: missing check input ${checkSelector}`);

  if (checkInput) {
    checkInput.value = "2500";
    checkInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const saveInvoiceBaseline = fetchLog.filter((entry) => entry.op === "save_invoice").length;
  check(saveInvoiceBaseline === 0, `print invoice save: expected no prior save_invoice posts, got ${saveInvoiceBaseline}`);

  const printSelector = "#print-invoice-btn";
  const printButton = $(printSelector) as HTMLButtonElement | null;
  check(!!printButton, `print invoice save: missing print button ${printSelector}`);
  printButton?.click();
  await settleAsyncWork();

  const saves = fetchLog.filter((entry) => entry.op === "save_invoice");
  check(saves.length === 1, `print invoice save: expected exactly one save_invoice POST, got ${saves.length}`);
  check(saves[0]?.method === "POST", `print invoice save: save_invoice method should be POST, got ${JSON.stringify(saves[0]?.method ?? null)}`);
  check(saves[0]?.body?.id === "0042", `print invoice save: save_invoice id should be 0042, got ${JSON.stringify(saves[0]?.body?.id ?? null)}`);
  check(
    Array.isArray(saves[0]?.body?.lines) && saves[0].body.lines.length >= 1,
    `print invoice save: save_invoice payload missing lines (${JSON.stringify(saves[0]?.body?.lines ?? null)})`
  );
  check(
    saves[0]?.body?.lines?.[0]?.paid === 2500,
    `print invoice save: first payload line paid should be 2500, got ${JSON.stringify(saves[0]?.body?.lines?.[0]?.paid ?? null)}`
  );
  check(
    typeof saves[0]?.body?.oop_pct === "number",
    `print invoice save: oop_pct should be numeric, got ${JSON.stringify(saves[0]?.body?.oop_pct ?? null)}`
  );

  const statusText = text("#save-status-text");
  check(statusText === "Invoice #4 saved", `print invoice save: save status should be Invoice #4 saved, got ${statusText}`);

  printButton?.click();
  await settleAsyncWork();
  const savesAfter = fetchLog.filter((entry) => entry.op === "save_invoice");
  check(
    savesAfter.length === 1,
    `print invoice save: identical reprint should not POST again (save_invoice count ${savesAfter.length})`
  );

  return {
    saveInvoiceCount: saves.length,
    op: saves[0]?.op ?? null,
    id: saves[0]?.body?.id ?? null,
    lineCount: Array.isArray(saves[0]?.body?.lines) ? saves[0].body.lines.length : 0,
    firstLineName: saves[0]?.body?.lines?.[0]?.name ?? null,
    firstLinePaid: saves[0]?.body?.lines?.[0]?.paid ?? null,
    statusText,
    dedupedCount: savesAfter.length,
  };
}

// ── Drive: per template → structure, then both print modes ─────────
const snapshot: Record<string, unknown> = {};
for (const key of Object.keys(EXPECTED) as TemplateKey[]) {
  snapshot[key] = {
    structure: snapshotTemplate(key),
    printProgress: snapshotPrint("progress"),
    printInvoice: snapshotPrint("invoice"),
  };
}
snapshot.bankDrawEntry = snapshotBankDrawEntry();
snapshot.invoiceBuilderEntry = snapshotInvoiceBuilderEntry();
snapshot.valueSyncIntegrity = snapshotValueSyncIntegrity();
snapshot.cascadeTriggers = snapshotCascadeTriggers();
snapshot.previousInvoice = await snapshotPreviousInvoice();
snapshot.printInvoiceSave = await snapshotPrintInvoiceSave();

// ── Golden master compare / update ──────────────────────────────────
const serialized = JSON.stringify(snapshot, null, 2);
if (UPDATE || !existsSync(GOLDEN)) {
  writeFileSync(GOLDEN, serialized + "\n");
  console.log(`golden master ${existsSync(GOLDEN) && UPDATE ? "updated" : "created"}: tests/golden/smoke.golden.json`);
} else {
  const golden = readFileSync(GOLDEN, "utf8").trim();
  if (golden !== serialized) {
    errors.push("golden master mismatch — diff tests/golden/smoke.golden.json, then --update only if the change is intentional");
    // Show a compact diff hint: first differing line.
    const a = golden.split("\n"), b = serialized.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        errors.push(`  first diff at golden line ${i + 1}: expected ${JSON.stringify(a[i])} got ${JSON.stringify(b[i])}`);
        break;
      }
    }
  }
}

// ── Verdict ─────────────────────────────────────────────────────────
const elapsedMs = Date.now() - started;
check(elapsedMs < 30_000, `runtime budget blown: ${elapsedMs}ms >= 30s — harness must stay a pre-push gate, not a chore`);
const elapsed = (elapsedMs / 1000).toFixed(1);
if (errors.length) {
  console.error(`SMOKE FAIL (${errors.length}) in ${elapsed}s:`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log(`SMOKE PASS in ${elapsed}s — 4 templates × structure + 2 print modes verified`);
process.exit(0);
