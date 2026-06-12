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

const errors: string[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) errors.push(msg);
}

// ── Boot ────────────────────────────────────────────────────────────
GlobalRegistrator.register({ url: "https://localhost/planner.html" });

// Offline guard: no endpoint is configured (fresh localStorage → setup-banner
// path); any stray network call must fail loud, not hang.
(globalThis as any).fetch = async () => {
  throw new Error("network disabled in smoke harness");
};
(globalThis as any).print = () => {};

const html = readFileSync(PLANNER, "utf8");
document.write(html);

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

// ── Capture helpers ─────────────────────────────────────────────────
const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => document.querySelectorAll(sel);
const text = (sel: string) => ($(sel)?.textContent || "").replace(/\s+/g, " ").trim();

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
  if (mode === "invoice") {
    check(printingInvoice, "invoice print: body missing printing-invoice class");
    check(prRows === 0, `invoice print: progress doc not emptied (${prRows} rows leaked)`);
  } else {
    check(!printingInvoice, "progress print: printing-invoice class leaked");
    check(invRows === 0, `progress print: invoice doc not emptied (${invRows} rows leaked)`);
    check(prRows > 0, "progress print: pr-tbody is empty");
  }
  window.dispatchEvent(new Event("afterprint"));
  return { prRows, invRows, printingInvoice };
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
