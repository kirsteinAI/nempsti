---
type: architecture-review
plan: system-plan.md
date: 2026-04-08 01:19:44
mode: standalone
verdict: needs-iteration
average-score: 9.7
categories-below-9.5: 2
blocking-issues: 0
---

# Architecture Plan Review: system-plan.md

## Review Scope
- Target plan: `docs/plans/architecture/system-plan.md`
- Mode: `standalone`
- Repository evidence used: no

## Category Scores

### 1. Usage Context & Platform Fit
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: The plan is unusually precise about context. §1 names the exact user population (PiA under PsychThG), the exact hardware profile (Pixel 8a, Chrome for Android, installed as PWA), the secondary profiles (iPad/Desktop), and the real-world interaction shape (30 s–3 min sessions, several times per week, typically right after a therapy appointment). The "UI friction budget" framing in §1 converts this context into a hard decision rule ("every extra second or tap in the main flow is a hard justification argument"). The §1 usage contract ("one device, one user, one Google Drive account") explicitly bounds Phase 1 and cites §12 for the Phase-3 relaxation. §4.11 turns the platform assumption into concrete browser minimums.

**Suggestions**:
- Add an explicit note on how portrait-only `display: standalone` (§4.7) interacts with iPad/Desktop expectations, so downstream feature plans know whether landscape is a supported secondary state or explicitly out of scope.
- Add one line specifying the CSS-pixel viewport budget for the other listed devices (only Pixel 8a gets `412 × 915` in §4.8); feature plans that build forms or dialogs will need this.

### 2. Tech Stack Specification
**Score: 9.7 / 10** (anchor level: excellent)

**Justification**: §4.1 names exact languages (HTML5, CSS3, vanilla JS ES2020+), exact module strategy (ES modules via `<script type="module">`), exact absence of tooling (no framework, no bundler, no build step), and exact runtime dependencies (only GIS from `accounts.google.com/gsi/client`, no `gapi.client`). Versions are pinned where they matter: Node 20 LTS for tests (§4.1, §8.8), Playwright 1.58.2+ (§8.1), Chrome 120+ / Safari iOS 16.4+ / Firefox 120+ (§4.11). The "raw IndexedDB API, no `idb`/`dexie`" decision is explicit with rationale (§4.1). Feature plans can inherit these without guessing.

**Suggestions**:
- Name the exact Node Test Runner API surface used (e.g., `node:test` + `node:assert/strict`) so unit tests written by different feature authors don't drift between assertion styles.
- Specify which ES2020+ features you rely on in shipped code (optional chaining, nullish coalescing, top-level `await` in modules, `structuredClone` is ES2022 — relevant to §10.3). `structuredClone` in particular is not ES2020, so either the stack label should read "ES2022+" or §10.3 should switch to an alternative.

### 3. System Architecture & Design
**Score: 9.6 / 10** (anchor level: excellent)

**Justification**: §4 gives a complete picture: module layout (§4.2), ownership diagram (§4.3 with `state.js` owning `appData` and `updateAppData(patchFn)` as the single mutation entry point), two-layer persistence (§4.4), Drive integration (§4.5), Service Worker strategy (§4.6), PWA manifest (§4.7), UI architecture (§4.8), rendering strategy with per-tab `try/catch` isolation (§4.9, §7.4), ID generation (§4.10), and browser compatibility (§4.11). The data-flow diagram makes the mutation pipeline unambiguous. The debounce-clock ownership note ("debounce clock lives in `db.js`, `state.js` only calls `scheduleWrite()`") prevents a very common refactor collision. The one mark-down: §6.8 permits inline `onclick="..."` attribute handlers, which the §6.3 CSP cannot actually execute (see §7 below). That's a real correctness tension with the rendering pattern the rest of the plan relies on.

**Suggestions**:
- Reconcile the `onclick="..."` pattern with the CSP: either (a) add `'unsafe-hashes'` + per-handler SHA-256 hashes to `script-src` and list the policy, (b) switch the architectural pattern to `addEventListener` + data-attributes (document this change in §4.10/§6.8), or (c) document explicit use of event delegation at `document.body` with a data-id lookup. Whatever is chosen must be reflected in `render.js` conventions so parallel feature plans don't re-introduce attribute handlers.
- `app.js` is described as both the init/wiring module and the holder of event handlers and modals (§4.2, §15.4), while the §15.4 split-convention says the split to `tabs/*.js` is "not a Phase-1 goal". Add a one-line expectation for Phase 1 about what belongs in `app.js` vs. a future tab module so feature plans don't bloat `app.js` ad-hoc on the way to the 1000-line threshold.
- Add an explicit statement on history/back-button behavior for the tab-based SPA (tab state in URL hash? `popstate`?). This affects how feature plans add new tabs or subroutes.

### 4. Data Model
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: §3 is exemplary. It defines format conventions as binding constants (§3, "Format-Konventionen"), every entity with typed required/optional fields, explicit invariants (§3, 8 numbered rules), a canonical JSON example anchored to Schema v1, and a clear migration regime (append-only, transactional, snapshot rollback in §10.3). Deliberate exclusions ("Bewusst weggelassen": diagnosis, therapy method, approval status, notes) are listed and deferred to the roadmap so feature plans have a license to say "no". Referential-integrity/cascade behavior is a table (§3). Orphan supervisions are explicitly permitted and flagged in the UI. This is enough for feature plans to build confidently.

**Suggestions**:
- Add an explicit note to the canonical example about whether `settings.dsgvoAcknowledgedAt` (introduced in §6.5) is part of the v1 shape; if yes, include it in the canonical example so the test fixture matches reality.
- State whether `string`-field max length 500 applies to `note` fields (which users might stretch) and to `supervisor` strings; the rule says "all string fields", but a short explicit example would remove ambiguity for import validation.
- For `supervisionGroup.patientIds` invariant 6, clarify what happens when a referenced patient no longer exists at import time (reject the record? strip the id?). §3 delete cascade covers runtime, but import time is a distinct path.

### 5. Third-Party Dependencies
**Score: 9.7 / 10** (anchor level: excellent)

**Justification**: §4.5 enumerates the Drive API surface (list/create/update/download) with exact endpoints, specifies auth via GIS Token Client with `drive.appdata` scope, clarifies token-expiry handling (silent re-auth with `prompt: ''`), and defines the degradation path (§4.5, §7.6: "app continues locally, Drive status indicator"). §6.4 explicitly accepts the SRI tradeoff with four compensating controls. §4.4 ("Quota-Kontext") addresses quota fit. §16 gives a full Google Cloud setup guide so the human dependency is reproducible. The plan is also honest about lock-in ("Drive is the only cloud endpoint", rule §14.3).

**Suggestions**:
- Document what happens if `accounts.google.com/gsi/client` is unreachable on cold start (e.g., corporate firewall, CDN outage): does the app still boot into local-only mode, or does a script-load failure block rendering? The Service Worker strategy §4.6 says GIS is Network-First + Cache-Fallback, but doesn't say whether an initial cache miss offline is fatal to rendering.
- Note what happens if the app is used from an "Authorized JavaScript origin" that doesn't match the OAuth client (e.g., developer running `localhost:3123`). Add a line to §16 about adding `http://localhost:3123` or similar to the OAuth client during development.

### 6. Error Handling & Resilience Strategy
**Score: 9.7 / 10** (anchor level: excellent)

**Justification**: §7 covers IndexedDB errors (§7.1 table), Drive sync retries/backoff (§7.2 matrix with HTTP-status-specific behavior), restore atomicity (§7.3 six-step contract with the guarantee that a partial payload can never replace in-memory state), render isolation (§7.4 + §4.9), SW update behavior with the 14-day stale-client upper bound (§7.5, §4.6, §10.4), and auth loss (§7.6). Each failure class has a visible user outcome, a recovery path, and a rule about what state survives. The explicit "no offline queue in Phase 1, `dirty` flag lives in IDB" decision is the right amount of architectural precision for MVP.

**Suggestions**:
- `QuotaExceededError` (§7.1) says "mutation rolls back" by reloading from the last successfully-saved IDB state — but the write was debounced (300 ms) and may have coalesced several logical mutations. Spell out how the user's last N user-visible actions reconcile with the rollback (are they lost? replayed?), and whether the toast should warn "last change may be unsaved".
- §7.2 "dirty flag persists in IDB" — state whether that flag is part of `appData` (and thus versioned) or a sibling key. If it lives inside `appData`, it is visible to migrations and must be preserved; if it lives in a sibling object store, that needs to appear in the §4.2 file/store inventory.
- Clarify the "Transaction abgebrochen → stiller Retry einmal" behavior: does the retry also re-run the `patchFn`, or does it re-serialize the current `appData`? If the former, `patchFn` must be idempotent; say so as a rule in §15.

### 7. Security Considerations
**Score: 9.4 / 10** (anchor level: strong)

**Justification**: The plan is thorough on intent: XSS via mandatory `escapeHtml()` with a mandatory payload battery (§6.1), a three-path validator (§6.2), an explicit CSP meta-tag (§6.3), a documented SRI tradeoff (§6.4), a DSGVO first-run modal (§6.5), an explicit Phase-1 "no at-rest encryption" position with rationale (§6.6), OAuth scope minimality (§6.7), and "no telemetry" (§6.9). The score is pulled down by a concrete correctness issue: §6.3's CSP has `script-src 'self' https://accounts.google.com https://apis.google.com` with neither `'unsafe-inline'`, `'unsafe-hashes'`, nor per-handler hashes — yet §6.8 explicitly relies on inline `onclick="fn('${id}')"` attribute handlers, which browsers treat as inline script and block under this policy. Rule §14.15 re-asserts "no `'unsafe-inline'` in `script-src`", so the policy as written is internally consistent — but the rendering pattern §6.8 depends on is not executable under it. This must be resolved before feature authors will be able to ship any clickable UI at all.

**Suggestions**:
- Decide on ONE of the following and update §6.3, §6.8, §4.10, and rule §14.15 accordingly: (a) add `'unsafe-hashes'` plus explicit SHA-256 hashes for each inline handler string (this constrains IDs to a small, static handler-name surface, which your Base-36 ID pattern already supports if the template is fixed); (b) replace all `onclick="..."` attributes with `addEventListener` + `data-id` attributes plus a single delegated listener at the tab root; (c) rebuild the DOM with property assignment (`el.onclick = ...`), which is NOT attribute-style and is allowed by CSP. Each path has different ergonomics — pick and document.
- Add a mandatory test to `grenzwerte.spec.ts` (or a new CSP spec) that asserts the served `Content-Security-Policy` meta-tag matches the policy in §6.3 verbatim, so drift in feature PRs is caught in CI.
- Add an explicit XSS test for the `supervisor` and `note` fields (§6.1 currently names "Patientennamen, Notizen, Supervisornamen" in prose; making the test list an exhaustive field inventory prevents new fields from slipping past the battery).
- `form-action 'none'` (§6.3) forbids form submissions, while §4.8 allows `<form>` elements. Add one line clarifying the expectation: forms are only for input grouping and all submissions go through `event.preventDefault()` + JS handlers — so `form-action 'none'` is intentional, not a bug.

### 8. Testing Strategy
**Score: 9.7 / 10** (anchor level: excellent)

**Justification**: §8 is very specific: two-layer testing (Node Test Runner for units, Playwright for E2E), named test files with per-file responsibilities (§8.1), a device coverage matrix that marks `pixel8a` as a hard gate (§8.2), Drive-mocking as a CI-enforced rule (§8.3), performance budgets with measurement method per metric (§8.4), a PWA offline verification pattern (§8.5), an append-only migration-test rule with fixture conventions (§8.6), a legacy-to-v1 end-to-end test (§8.7), a CI/OS matrix (§8.8), and per-feature test rules (§8.9). The §14 conventions (rule 11, rule 17, rule 18) re-assert testing as non-negotiable. Feature plans can inherit and extend this without guesswork.

**Suggestions**:
- Specify how `tests/helpers.ts` coexists with `tests/unit/*.test.js` — the unit layer is `.js` (Node Test Runner), but `helpers.ts` and `.spec.ts` imply a TypeScript toolchain somewhere. State whether Playwright runs `ts-node` / tsx / Playwright's built-in TS support, and whether that counts as a "build step" under rule §14.8 (it usually doesn't, but say so).
- Add a CI guard test for the §4.10 ID generation: a property-based fuzz that no generated ID contains characters outside `[0-9a-z]`. This is the invariant §6.8 relies on.
- Add one line on how the CSP is tested (see §7 suggestions) — `grenzwerte.spec.ts` is a natural home.
- Specify the guard-grep for §8.3 "no real Google accounts" concretely (e.g., "grep for `oauth2.googleapis.com` outside of mocks"), so the CI rule is reproducible.

### 9. Observability & Operational Readiness
**Score: 9.6 / 10** (anchor level: excellent)

**Justification**: For a single-user local-first PWA with the "no telemetry" rule (§6.9, §14.16), the right observability model is on-device self-service diagnosis, and §5.7 delivers exactly that: IndexedDB size, last successful Drive sync timestamp, last sync error with HTTP status, last per-tab render error, schema version, SW cache version, and a "copy diagnosis JSON" button. The entry point (5-tap on header or `?debug=1`) is appropriately hidden from normal users. The "local only, no upload" scope is stated.

**Suggestions**:
- State where the diagnosis data lives: is it a separate IDB store? a sibling key? part of `appData`? This affects whether it survives "Daten löschen" (§5.6) and whether it's covered by migrations.
- Add a minimum retention rule (e.g., "last 10 errors per tab", "last 5 sync errors") so the diagnostic buffer doesn't grow unbounded.
- Add one line about what gets surfaced on the 14-day stale-client force-reload (§7.5) — is there a toast afterwards explaining "we updated you because your app was >14 days old"? This avoids support confusion.

### 10. Performance & Scalability
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: §9 defines a clear scale envelope (baseline, upper bound, 2× stress) with a four-column table covering patients, sessions, supervisions, groups, and serialized `appData` size, then ties those numbers to budgets in §8.4 (TTI cold/warm, INP, `renderAll()` at baseline vs. 2× stress, JSON export, SW install). The escalation rule in §9.3 makes "when do we switch to incremental rendering?" a numeric threshold rather than a feeling. §9.5 walks through the INP path step by step. §9.6 explicitly removes Drive sync from the interactive budget. Feature plans can answer "is my feature too slow?" without guessing.

**Suggestions**:
- Add a measurement method for the in-memory budget (§9.2) — "~1–2 MB heap for a 300 KB serialized `appData`" is an educated guess; a `performance.memory` or DevTools heap snapshot pattern would make it verifiable in `skalierung.spec.ts`.
- State whether `renderAll()` performance is measured in a throttled CPU profile (Playwright supports CDP CPU throttling) or at native speed, so the `pixel8a` number is reproducible across dev machines.

### 11. Rollout, Migration & Backward Compatibility
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: §10 covers release mechanism (§10.1), the legacy single-file-HTML migration flow (§10.2) with a pinned end-to-end test (§8.7), migration rollback via `structuredClone` snapshot (§10.3), stale-client upper bound (§10.4), version-conflict handling for `version > CURRENT_VERSION` with an explicit "no automatic degradation" rule (§10.5), the append-only migration rule (§10.6, echoed in §14.10), and — crucially — §10.7 which honestly addresses the "can't roll back a schema bump" corner case with a vorwärts-only mitigation. This is rare and high-quality scope control.

**Suggestions**:
- `structuredClone` in §10.3 is ES2022, not ES2020 (see §2 suggestion). Either bump the stack label or use a JSON-roundtrip alternative and note the fidelity tradeoff.
- §10.1 says `CACHE_VERSION` must be "manually incremented" and §10.7 says "never decrement". Add a small CI check (even a grep) that fails the PR if `sw.js` source changes without `CACHE_VERSION` moving forward, so releases can't ship without cache invalidation.
- §10.2 step 2 says "OAuth consent + DSGVO pass through", but the legacy user has no existing Drive state to restore. Confirm that the PWA's cold-start flow gracefully handles "IDB empty AND Drive empty" so the migration import in step 3 lands on a clean, DSGVO-ack'd shell (today the flow in §4.4 says "IDB empty → restore from Drive", which would do nothing here — just state it's a no-op, not an error).

### 12. MVP Scope Definition
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: §11.1 provides a 13-item Definition of Done that is checklist-verifiable (all E2E profiles green, auto-load works from second start, DSGVO modal persists, JSON export/import, legacy migration test green, SW offline verified, CSP active, perf budgets met, diagnosis panel present, setup guide verified on a fresh account). §11.2 — the Phase-1 Freeze List — is the strongest part: it explicitly names 13 features that are NOT in MVP and cites the phase that owns them. That gives feature planners a ready-made "no, and here's why" tool against scope creep. The roadmap (§12) then gives each frozen item a home.

**Suggestions**:
- Add the CSP-reconciliation work (see §7) to the DoD — "CSP meta-tag matches the documented policy AND all clickable UI works under it" — so the known contradiction cannot ship unresolved.
- DoD item 13 ("setup guide verified on a fresh Google account + fresh device") is valuable but under-specified on the pass/fail condition; pin it to "walk the §16 steps, land on the homescreen icon, create a patient, force-kill Chrome, re-open, see the data" so the verifier has no ambiguity.

### 13. Feature Decomposition Readiness
**Score: 9.8 / 10** (anchor level: excellent)

**Justification**: §15 is a genuine feature-plan contract. §15.1 lists seven mandatory sections every feature plan must include (rule refs, affected modules, data-model delta, mutation patches, render hooks, test plan, rollback). §15.2 pins the mutation contract with code. §15.3 pins the render extension pattern with code. §15.4 documents a clean escape valve (split `app.js` into `tabs/*.js` at >1000 lines) without making it a Phase-1 task. Combined with the §4.2 module boundaries and the §14 rule list, feature plans have a well-known seam to attach to and a well-known set of invariants to preserve. This is the right level of specification to support parallel feature planning without collisions.

**Suggestions**:
- Add a short note on how two feature plans that both add a new tab should sequence their edits to `renderAll()` (§15.3): the "one added line" promise breaks cleanly under merge if two PRs touch the function simultaneously. A simple convention (e.g., "new tabs append at the end", "one PR at a time touches `renderAll`") removes the merge-collision risk.
- Clarify whether `getAppData()` returning a `structuredClone` (§15.2) is a per-call clone or a cached frozen view. A per-call clone is safer but has a cost in `renderAll()` hot paths with the 2× stress envelope — worth noting in §9 and §15.

### 14. Overall Coherence & Completeness
**Score: 9.4 / 10** (anchor level: strong)

**Justification**: The plan is internally very well-structured and the cross-cutting concerns (§14 rule list, §15 feature contract, §13 design principles) are unusually self-aware. However, the score is pulled below 9.5 by: (1) the CSP vs. inline-handler contradiction between §6.3/§14.15 and §6.8 — this is the single biggest unresolved correctness gap and it sits directly on the rendering pattern the whole UI depends on; (2) a few small cross-reference slips — e.g., §6.1 refers to "§15-Regelliste" but the rule list is §14, and §4.2 references "§16 Feature-Plan-Vertrag" but the feature-plan contract is §15 (setup is §16); (3) §10.3 and §15.2 use `structuredClone`, which is ES2022, while §4.1 names ES2020+ as the stack baseline. None of these are blockers, but each is the kind of drift that downstream feature authors will hit as "wait, which rule applies here?" friction.

**Suggestions**:
- Fix the CSP/inline-handler contradiction (see §7 suggestions). This is the single highest-impact edit for making the plan ready.
- Sweep cross-references: `§15-Regelliste` in §6.1 → `§14`; `§16 Feature-Plan-Vertrag` in §4.2 → `§15`. A quick pass looking for "Regelliste" and "Feature-Plan-Vertrag" mentions catches both.
- Bump the stack baseline to "ES2022+" (or justify `structuredClone` on Chrome 120+ / Safari 16.4+ / Firefox 120+, which do support it — in which case just update the stack label for coherence).
- Add a short "section index" at the top (just numbered titles) so feature authors can find §14 vs. §15 vs. §16 without paging through.

## Knowledge Limitations & Recommended Research
- **Playwright 1.58.2+** (§8.1) is past my training cutoff; I cannot verify whether the Pixel 8a device profile is a built-in or requires a custom descriptor in `playwright.config.ts`. Verify by running `npx playwright devices | grep -i pixel` against the installed version before relying on the `pixel8a` profile.
- **Chrome for Android 120+ PWA installability** (§4.11): I cannot verify the current exact PWA-install heuristics Chrome uses — especially whether `display: standalone` + `manifest.webmanifest` + a served icon set is still sufficient without additional criteria. Verify by running Lighthouse's "Installable" audit on a deployed build.
- **`drive.appdata` OAuth scope behavior under the 2024+ Google Auth changes** (§4.5, §6.7): I cannot verify whether `drive.appdata`-only apps still qualify for "non-sensitive scope" review or whether Google now requires verification even for single-scope app-data apps. Verify via `https://support.google.com/cloud/answer/9110914` before relying on the §16 "Publishing Status: In Testing" path for long-term use.
- **GIS Token Client silent re-auth with `prompt: ''`** (§4.5): the exact current behavior on mobile Chrome may have changed since my training cutoff. Verify with a real-device test on Pixel 8a before pinning §7.2's `401 → silent re-auth` flow.

## Summary

### Score Overview

| # | Category | Score |
|---|---|---|
| 1 | Usage Context & Platform Fit | 9.8 |
| 2 | Tech Stack Specification | 9.7 |
| 3 | System Architecture & Design | 9.6 |
| 4 | Data Model | 9.8 |
| 5 | Third-Party Dependencies | 9.7 |
| 6 | Error Handling & Resilience | 9.7 |
| 7 | Security Considerations | 9.4 |
| 8 | Testing Strategy | 9.7 |
| 9 | Observability & Operational Readiness | 9.6 |
| 10 | Performance & Scalability | 9.8 |
| 11 | Rollout, Migration & Backward Compatibility | 9.8 |
| 12 | MVP Scope Definition | 9.8 |
| 13 | Feature Decomposition Readiness | 9.8 |
| 14 | Overall Coherence & Completeness | 9.4 |
| — | **Average (excluding N/A)** | **9.7** |

### Top 3 Strengths
- Exceptionally honest scope control: §11.2 Phase-1 Freeze List names 13 features that are explicitly NOT in MVP and assigns each a future phase, giving feature reviewers a ready-made tool against scope creep; §10.7 even addresses the hard truth that schema bumps are forward-only.
- A real feature-plan contract in §15 (seven mandatory sections, mutation pattern pinned in code, render extension pattern pinned in code, `app.js` split documented as escape valve) plus the §14 rule list — together these give parallel feature planning a well-known seam and well-known invariants.
- End-to-end decision discipline on persistence: single-owner `appData` in `state.js`, single mutation entry point `updateAppData(patchFn)`, debounce-clock ownership called out explicitly, three identical load-path validations (IDB/Drive/import), atomic restore with snapshot rollback (§7.3), and a single canonical JSON example (§3) that doubles as the test fixture.

### Top 3 Critical Improvements
- **Resolve the CSP vs. inline-handler contradiction.** §6.3 CSP + §14.15 "no `'unsafe-inline'` in `script-src`" forbids exactly the `onclick="fn('${id}')"` pattern §6.8 relies on. Pick one path (`'unsafe-hashes'` + hashes / `addEventListener` + delegation / DOM property assignment), document it in §6.8 and §4.10, and add a CSP-conformance test so the policy can't drift. This is the single edit with the largest downstream effect.
- **Sweep small cross-reference drift that will confuse feature authors.** §6.1 refers to the "§15-Regelliste" but rules live in §14; §4.2 refers to "§16 Feature-Plan-Vertrag" but the feature contract is §15 (setup is §16); `structuredClone` (§10.3, §15.2) is ES2022 while the stack label (§4.1) reads "ES2020+". Low-effort, high-clarity.
- **Close three small but load-bearing runtime ambiguities**: (a) what does the §7.1 `QuotaExceededError` rollback do to unsaved user actions that were coalesced in the 300 ms debounce window; (b) where does the `dirty` flag live (inside `appData` → migration-visible, or sibling store → needs to appear in the §4.2 inventory); (c) whether `patchFn` must be idempotent under §7.1's silent transaction retry. Each is a one-line answer that prevents feature plans from making incompatible assumptions.

### Detailed Improvement Suggestions
(Listed in "Suggestions" under each category above that scored below 9.5.)

**§7 Security Considerations (9.4) — see category for full list.** The load-bearing item is the CSP/inline-handler reconciliation; everything else (CSP meta-tag conformance test, explicit field inventory for the XSS battery, `form-action 'none'` rationale) is cheap follow-up.

**§14 Overall Coherence & Completeness (9.4) — see category for full list.** Fix the CSP contradiction, sweep the cross-references (`§15-Regelliste` → `§14`, `§16 Feature-Plan-Vertrag` → `§15`), bump the stack baseline to ES2022+ or remove `structuredClone`, and add a short numbered section index at the top.

### Open Questions
- Is the tab-based SPA (§4.8) expected to reflect tab state in the URL (hash or pushState) so the browser Back button works on Pixel 8a as an installed PWA? Feature plans that add new tabs need the answer.
- Does the §5.7 diagnosis buffer live inside `appData` (so it survives rollbacks and goes through migrations) or outside it (so "Daten löschen" in §5.6 does not nuke it)?
- Is `http://localhost:3123` (or similar) expected to be registered as an Authorized JavaScript origin for local development, or does local dev use a service-account / mock GIS path?
- How does the OAuth client's "Publishing Status: In Testing" policy (§16) interact with long-term personal use — does the test-user token expire periodically and require re-adding, and should the plan warn about this?

### Blocking Issues
(none — see verdict)

### Readiness Verdict
**needs-iteration** — the plan is otherwise near-excellent, but the §6.3 CSP as specified cannot execute the §6.8 inline-handler rendering pattern that the UI depends on; resolve that contradiction (plus the small cross-reference drift and the three small runtime ambiguities) and re-run this review.
