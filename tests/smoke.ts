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

// ── Drive: per template → structure, then both print modes ─────────
const snapshot: Record<string, unknown> = {};
for (const key of Object.keys(EXPECTED) as TemplateKey[]) {
  snapshot[key] = {
    structure: snapshotTemplate(key),
    printProgress: snapshotPrint("progress"),
    printInvoice: snapshotPrint("invoice"),
  };
}

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
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (errors.length) {
  console.error(`SMOKE FAIL (${errors.length}) in ${elapsed}s:`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log(`SMOKE PASS in ${elapsed}s — 4 templates × structure + 2 print modes verified`);
process.exit(0);
