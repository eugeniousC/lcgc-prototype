# LCGC — Project Memory

> Project-scoped context for the LC General Contracting planner repo. Loads on top of
> the global PAI `~/.claude/CLAUDE.md` when a session starts in this folder. **Project
> facts + conventions only** — global PAI rules still govern behavior and win on conflict.

## What this is
Static-site prototype for **LC's General Contracting & Remodeling** — a custom-home
builder in **West Georgia** (four counties: Carroll, Coweta, Haralson, Paulding). No
framework, no build step, no bundler — every page is a single self-contained HTML file
with its own inline CSS and JS.

## Repo layout
- `index.html` — marketing site (custom homes, seven specialties, portfolio, contact).
- `LC_Construction_Budget_Planner.html` — **flagship app, the only actively developed file.**
  Construction budget + draw-schedule planner: Quickstart (SQFT × $/sqft → budget), O&P
  slider (10–30%), 44-line bank draw schedule, Customer View + Bank Draw tabs, project
  progress bar, PDF export, customer-record persistence. **Current: v1.4.9.**
- `LC_Construction_Budget_Planner.2026-05-27-v1.html` — archived snapshot. **Do not edit** —
  point-in-time reference only.
- `atScale_Home_Budget_Planner.html`, `atScale_Pool_Build_Planner.html`,
  `LC_Outdoor_Living_Planner.html` — sibling/legacy planners. Len only cares about the
  Construction planner; the others are not in active scope.
- `Plans/` — backend + design docs:
  - `AppsScript.gs` — Google Apps Script backend (the persistence server). **Source/reference
    only — not loaded by the browser. Editing it does NOT change live planner behavior**
    until it's re-pasted into the Apps Script editor and redeployed.
  - `SetupGuide.md` — step-by-step deploy of the Apps Script web app (also the Len-onboarding guide).
  - `v1.4-persistence-spec.md` — customer-record data model spec.
- `screenshots/` — legacy verification artifacts. **Gitignored, regenerable, NOT source of
  truth.** Don't rely on them as canonical state.

## Architecture notes
- **Persistence is serverless:** Google Sheets + Apps Script web app. The planner GET/POSTs
  to an Apps Script `/exec` endpoint. The URL is **not hardcoded** — the user pastes it into
  a setup banner; it's stored in `localStorage` under key `lcgc_appsscript_url`. Other LS
  keys: last-loaded customer id and a dirty-state mirror for offline resilience.
- A customer record = full planner state (sqft, $/sqft, O&P %, all 44 line budgets, all 44
  paid amounts) + an immutable zero-padded ID (`0001`…) + an editable description.
- **Zero-padding gotcha (real bug we fixed):** Google Sheets coerces `'0001'` → number `1`
  unless column A is forced to plain-text format (`setNumberFormat('@')`). Reads must defend
  with `padId_()`. This broke load/save in v1.4 → fixed in v1.4.1. Don't regress it.
- **O&P on paid amounts (v1.4.9):** the total project budget is O&P-inclusive, but Amount
  Paid cells are build-level dollars. The progress bar / summary strip gross up paid by
  `(1 + oop/100)` so a fully-paid build reads a true 100%. Per-phase draw cards intentionally
  do NOT gross up (build-vs-build is internally consistent).
- **iPad/Safari is a target.** localStorage writes are guarded (try/catch) because iPad
  Safari/Chrome Private/Incognito throws `QuotaExceededError` on `setItem`. All iPad browsers
  run on WebKit, so Chrome Incognito hits the same wall as Safari Private Browsing.

## Conventions
- **Keep each HTML file self-contained** — inline CSS/JS, no separate assets, no framework
  or build tool unless explicitly asked. This is a deliberate constraint, not tech debt.
- **bun/bunx only, never npm/npx** (global PAI rule). Vanilla JS in the planner; no deps.
- **Versioning:** the planner advances by semver-ish tags. Commit messages follow
  `vX.Y.Z: short description` (e.g. `v1.4.9: Gross up Amount Paid by O&P in progress bar`).
  Bump the version + use this format on meaningful changes.
- **Git:** single `main` branch, remote `origin` → `git@github.com:eugeniousC/lcgc-prototype`
  (SSH). Repo is **public** — required for the GitHub Pages free tier. Pushing to `main`
  auto-deploys Pages. **Per global PAI rule, ask before pushing to remote.**
- **Live site:** `https://eugeniousc.github.io/lcgc-prototype/LC_Construction_Budget_Planner.html`
  (note: `eugeniousc.github.io/lcgc-prototype`, NOT `ewcolemanjr`).
- **Verify web changes with the Interceptor skill against the live Pages URL** — never
  headless/agent-browser (global PAI rule; headless misses real-Chrome rendering). After any
  push, poll Pages for the rebuild, then confirm behavior with `interceptor`. **Deploy is the
  test** — two real bugs (zero-padding, iPad localStorage throw) slipped past committed code
  review and only surfaced on a live deploy.

## People
- **Eugene** (ewcolemanjr@gmail.com) — owner/operator of this repo; building a fractional
  consulting practice, of which this planner is a client deliverable.
- **Len** — the contractor this is built for; the persistence layer exists so Len can
  save/name/reload customer records. Currently connects to Eugene's spreadsheet during demos;
  giving Len his own sheet + deployment is a separate, scoped onboarding (`Plans/SetupGuide.md`).
