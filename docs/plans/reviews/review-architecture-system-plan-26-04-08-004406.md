---
type: architecture-review
plan: system-plan.md
date: 2026-04-08 00:44:06
mode: standalone
verdict: needs-iteration
average-score: 9.4
categories-below-9.5: 6
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
**Justification**: The plan is exceptionally specific about who uses the app (PiA — Psychologische Psychotherapeut:innen in Ausbildung per PsychThG), the primary device (Google Pixel 8a, Chrome for Android, installed as PWA on homescreen), secondary platforms (iPad, desktop browsers), and the real usage pattern (dokumentieren der Behandlungs- und Supervisionsstunden, Nullreibung beim Start). Section 1 and Section 9 make the target context unmistakable, and the "why not single-file HTML anymore" passage (§1) cites a concrete platform constraint — manual JSON file load/export is inakzeptabel on smartphones. The regulatorische Hintergrund (§2) anchors the product in real domain rules.
**Suggestions**:
- Add an explicit note on how many concurrent users the PWA is designed for — the plan implies single-user/single-account but never states "ein Gerät, ein Nutzer, ein Drive-Konto" as a contract.
- Specify the expected session length and usage frequency (e.g. "kurze Sessions, mehrmals pro Woche, meist nach einem Behandlungstermin") so downstream feature plans can calibrate UI friction budgets.

### 2. Tech Stack Specification
**Score: 9.6 / 10** (anchor level: excellent)
**Justification**: Languages and runtimes are pinned (HTML5, CSS3, Vanilla JS ES2020+), dependency footprint is zero at runtime except GIS/gapi from Google CDN, hosting is fixed (GitHub Pages HTTPS), and browser minimums are tabulated (§4.11). Playwright version is pinned (`^1.58.2`). The deliberate rejection of bundlers and frameworks is justified against the Zero-Build, Zero-Dependency principle (§9).
**Suggestions**:
- State which IndexedDB approach `db.js` uses — raw `indexedDB` API, a thin helper, or a vendored micro-wrapper — so later plans don't accidentally introduce `idb` or similar dev deps.
- Pin the Node version expectation for the test server (`npx serve`) to avoid a mismatch between CI and local, e.g. "Node 20+".
- Clarify whether `gapi` is still required at all now that GIS is the OAuth path — the plan mentions both, but the §4.4 API-Calls list could be served by `fetch` alone, eliminating one external script.

### 3. System Architecture & Design
**Score: 9.7 / 10** (anchor level: excellent)
**Justification**: §4 decomposes the system cleanly: file layout (§4.2), two-layer persistence with explicit precedence rules (§4.3), Drive integration flow (§4.4), Service Worker strategy (§4.5), manifest (§4.6), UI architecture (§4.7), rendering strategy with explicit tradeoff rationale (§4.8), error boundaries (§4.9), ID generation (§4.10), and browser support matrix (§4.11). Section 10 captures the non-negotiable rules into a single reference list — that is unusually disciplined. Conflict resolution is deferred explicitly to Phase 2/3 with a stated single-device assumption rather than silently left open.
**Suggestions**:
- Diagram the data flow between `app.js`, `db.js`, `drive.js`, and `migrations.js` (even an ASCII box-and-arrow) to lock down which module owns writes, the debounce clock, and the visibility trigger.
- State whether `migrations.js` runs on Drive-restored payloads before or after IndexedDB persists them — the §3 migration rules mention both origins but the ordering is not explicit.
- Clarify where the singleton `appData` in-memory state lives (inside `app.js` or a dedicated store module) so later features know where to read/mutate.

### 4. Data Model
**Score: 9.5 / 10** (anchor level: excellent)
**Justification**: Every entity has a typed field table (Patient, Session, Supervision, SupervisionGroup), relationships are explicit via `patientIds` arrays, cascading delete behavior is tabulated with an honest note on orphan supervisions (§3), and schema versioning uses a sequential migration array pattern that is cleanly described. Validation rules are listed in §6.2 and deliberately shared across import/restore paths. The "bewusst weggelassen"-List keeps MVP scope honest.
**Suggestions**:
- Pin the date format — `string (date)` is ambiguous. State ISO 8601 `YYYY-MM-DD` (local calendar date, no time zone) or `YYYY-MM-DDTHH:mm:ss` as applicable, and name the constraint in one place so sessions/supervisions/patients stay consistent.
- Define the `id` string format and length constraint (already Base-36 alphanumeric per §4.10, but Section 3's table says only "string") — cross-link §4.10 from the schema tables.
- Spell out the uniqueness invariants (e.g. one `appData` record, `id` unique within each collection) so migration authors know what they must preserve.
- Add a concrete example of an end-to-end `appData` JSON blob for v1, so feature authors and test fixtures have a canonical shape to copy.

### 5. Third-Party Dependencies
**Score: 9.7 / 10** (anchor level: excellent)
**Justification**: Only two runtime externals (GIS, gapi), both loaded via CDN with deliberate justification. Scope is pinned to `drive.appdata`, the minimum possible. Fallback path when auth fails is explicit (app continues local-only with a banner). Setup is covered end-to-end in §11, including the "In Testing" publishing status that avoids Google review. Cost is implicitly zero (GitHub Pages free tier + Drive free quota). Lock-in is acknowledged — Drive is the only cloud target, but local IndexedDB remains a viable standalone mode.
**Suggestions**:
- Add a pinned version expectation or integrity check strategy for the two CDN scripts (GIS and gapi) — even a note that "we accept Google's rolling version, and test runs must mock Drive" is better than silence.
- Mention what happens if the Google Cloud project is suspended or the OAuth client revoked — the app continues to function locally, but the user experience of that degradation should be explicit for support.
- Note the `drive.appdata` quota contract (part of the user's 15GB Drive quota) so scaling assumptions later don't mis-estimate.

### 6. Error Handling & Resilience Strategy
**Score: 8.8 / 10** (anchor level: solid but incomplete)
**Justification**: §4.9 covers the main surfaces (IndexedDB try/catch + toast, Drive non-blocking with a status indicator, inline validation, import rejection). Service Worker cache fallbacks are correct. However, several realistic failure modes are either under-specified or deferred: IndexedDB quota exceeded is not called out; Drive 401/403/5xx handling beyond "nicht als Blocker" is not defined; there is no offline queue or retry policy in Phase 1, and the `beforeunload` Drive flush is admitted as "best-effort" without an explicit fallback (next `visibilitychange`? next app start?). The `renderAll()` strategy also needs a guard against render-time exceptions crashing the whole shell.
**Suggestions**:
- Define a retry/backoff policy for Drive sync failures in Phase 1, even if minimal (e.g. "one retry after 30s, then silence until next trigger").
- Specify behavior when IndexedDB throws `QuotaExceededError` or `InvalidStateError` — the toast message alone is not an actionable recovery path for users.
- Describe how `renderAll()` handles thrown errors inside a single view (error boundary per tab vs. fallback empty shell) so a bad record doesn't white-screen the app.
- Add a contract for what happens to the current in-memory `appData` if a Drive restore fails mid-flight — is it atomically discarded, or is the partial blob committed?
- Document the expected behavior of the "new version available" toast when the user ignores it — does the old cache remain indefinitely, or is there a hard-update threshold?

### 7. Security Considerations
**Score: 9.0 / 10** (anchor level: strong)
**Justification**: XSS is taken seriously (`escapeHtml()` mandate in §6.1 and rule 3 in §10), import validation is strict and shared with Drive restore (§6.2), OAuth scope is deliberately minimal (`drive.appdata` only, §6.4), the inline-handler pattern is justified by the Base-36 ID contract (§6.5), and the DSGVO framing correctly identifies the data as personenbezogene Gesundheitsdaten (§6.3). Telemetry and third-party requests are explicitly forbidden. However, a few gaps remain: no Content Security Policy is defined; no Subresource Integrity for the Google CDN scripts (which is admittedly hard given Google rotates URLs, but the tradeoff should be acknowledged); no encryption at rest for IndexedDB despite storing health data; and the "device is the user's responsibility" framing, while defensible, deserves explicit onboarding copy to set expectations.
**Suggestions**:
- Decide and document a CSP stance — even a baseline `default-src 'self'; script-src 'self' https://accounts.google.com https://apis.google.com` in an HTML meta tag is better than nothing.
- Acknowledge the SRI-impossibility for GIS/gapi explicitly and describe the compensating control (scope-minimal OAuth + same-origin DOM isolation).
- State a position on at-rest encryption: either "out of scope because device-bound and Drive is encrypted in transit/at rest by Google" (with that rationale written down), or "Phase 2 will add WebCrypto AES-GCM wrapping with a user-provided passphrase".
- Add a first-run DSGVO notice requirement — the user should see an explicit statement of what is stored, where, and what the Drive scope grants, satisfying informed consent.
- Require that `escapeHtml()` be covered by at least one unit-style E2E test with known XSS payloads (e.g., `<img src=x onerror=alert(1)>`) inserted via patient names and notes.

### 8. Testing Strategy
**Score: 9.3 / 10** (anchor level: strong)
**Justification**: §7 pins the framework and version, fixes the test directory, lists the six device profiles (with Pixel 8a as mandatory, directly matching the primary target), enumerates the spec files by concern, names shared helpers (`createPatient`, `seedIndexedDB`, `mockDriveClient`), and mandates `test-mapping.json` upkeep per feature. Drive mocking is required, real Google Accounts are explicitly forbidden. The rules in §7 are enforceable ("every new feature: at least one E2E test, Pixel 8a profile is pflicht"). However, performance thresholds for `skalierung.spec.ts` are not quantified, there is no explicit strategy for Service Worker / PWA install tests beyond "pwa.spec.ts" existing, and there is no unit-level testing layer for pure logic (stundenberechnung, migrations, validation) which would be faster to run in a pre-commit loop than full Playwright.
**Suggestions**:
- Define numeric performance budgets for `skalierung.spec.ts` (e.g., "1000 sessions across 30 patients must render the dashboard in <500ms on Pixel 8a profile").
- Add a lightweight unit-test layer for `migrations.js`, `escapeHtml()`, and the import validator — these are pure functions and don't need a browser.
- Specify how `pwa.spec.ts` will verify Service Worker offline mode deterministically (e.g., `page.context().setOffline(true)` after first load, then reload).
- State a rule that any migration bump must ship with a migration test: a v(n-1) fixture is loaded and asserted to round-trip to vn.
- Document whether Playwright CI runs on GitHub Actions and on which OS matrix — the plan implies this but never commits to it.

### 9. Observability & Operational Readiness
**Score: N/A**
**Justification**: This is a single-user, client-side-only PWA with no operator role, no server backend, and an explicit no-telemetry/no-analytics stance (§6.3) driven by the DSGVO-sensitive data. There are no "operators diagnosing production issues" — the end user is the operator. The category does not meaningfully apply per the skill's guidance that truly local-only non-operational project types score N/A.
**Suggestions**:
- Even though the category is N/A, add a short "self-service diagnostics" section: a hidden debug panel that surfaces IndexedDB size, last-successful-Drive-sync timestamp, and last error, so users can self-report issues meaningfully without telemetry.

### 10. Performance & Scalability
**Score: 9.0 / 10** (anchor level: strong)
**Justification**: §4.8 gives an honest scale estimate (10–30 patients, up to ~800 sessions over the full training) and justifies the `renderAll()` simplicity choice against that envelope. Debounced writes (300ms) and non-per-mutation Drive sync (§4.3) demonstrate thoughtful throttling. Cache-first Service Worker improves perceived load time. However, there are no explicit TTI/FCP/INP targets for the Pixel 8a, no stated memory budget, and no analysis of whether `renderAll()` remains acceptable at the upper scale edge (e.g., 60 patients × 40 sessions = 2400 rows on a dashboard re-render after every toast dismissal).
**Suggestions**:
- Add explicit mobile performance budgets (e.g., TTI <2s on 4G Pixel 8a, INP <200ms after a mutation).
- Quantify the worst-case `renderAll()` cost at 2× the expected scale and note the threshold at which view-level incremental rendering would become necessary.
- State the memory budget for the in-memory `appData` blob (rough upper bound in KB) so the debounced-write strategy has a performance ceiling to aim at.

### 11. Rollout, Migration & Backward Compatibility
**Score: 8.8 / 10** (anchor level: solid but incomplete)
**Justification**: Schema versioning and sequential migrations are cleanly specified (§3), the service worker cache version string is the update trigger (§4.5), the "neue Version verfügbar" toast is described, and the roadmap is phased (§8). The Setup guide (§11) walks through GitHub Pages, Google Cloud project, OAuth client, and verification. However, several rollout concerns are under-specified: there is no migration-from-Single-File-HTML path documented, only a vague JSON import as Escape-Hatch; there is no rollback plan for a bad migration (what if `migrations.js` throws mid-way through an upgrade?); there is no strategy for handling users stuck on an old Service Worker cache if they never reopen to see the update toast; and `version > CURRENT_VERSION` rejects loading but does not describe what the user is supposed to do next.
**Suggestions**:
- Document the explicit migration path from the legacy Single-File-HTML JSON export into v1 `appData` (it is implied via import, but the mapping should be spelled out or verified by a test fixture).
- Add a rollback/bisect strategy: wrap each migration in a try/catch that restores the pre-migration snapshot and shows an error toast with "JSON-Export erzwingen".
- Define a "stale client" upper bound — e.g., after 14 days of no updates, the Service Worker should hard-reload on next open, not wait for the toast.
- For the `version > CURRENT_VERSION` case, describe the user-facing recovery ("App aktualisieren über Browser-Refresh" and what to do if that doesn't work).
- State that migrations are append-only (never edited or re-ordered once released) so that already-upgraded clients are not re-run.

### 12. MVP Scope Definition
**Score: 9.7 / 10** (anchor level: excellent)
**Justification**: Phase 1 (§8) is explicitly equated with the MVP and tied back to §4 and §5. Phase 2 (sofortige Drive-Sync) and Phase 3 (Multi-Device) are explicitly out of scope. The "bewusst weggelassen" notes in §3 (no ICD-10, no Verfahren, no Notizen) lock that discipline into the data model itself. Roadmap priorities are labeled (hoch / mittel / niedrig). The scope line is sharp enough that a feature planner cannot accidentally pull Phase 2 work into MVP.
**Suggestions**:
- Add a one-sentence "Definition of Done" for Phase 1 — the exact conditions under which the MVP ships (e.g., "alle E2E-Tests grün auf Pixel 8a + IndexedDB Auto-Load + Drive Auto-Backup auf visibilitychange").
- List the "Phase 1 freeze candidates" — features that look tempting but must wait — so reviewers can cite the list when rejecting scope creep.

### 13. Feature Decomposition Readiness
**Score: 9.3 / 10** (anchor level: strong)
**Justification**: The file layout (§4.2) gives clean module seams (`db.js`, `drive.js`, `migrations.js`, `sw.js`, `app.js`), §10's Nicht-Verhandelbare Regeln give feature plans a concrete rulebook, and the tab-based UI in §4.7 (Dashboard, Patienten, Supervision, Gruppen, Daten) maps cleanly to feature slices. Test mapping (`test-mapping.json`) enforces decomposition-aware test coverage. However, `app.js` is essentially the UI monolith ("UI-Logik, Rendering, Event-Handler") and the plan does not describe how multiple parallel feature plans could touch it without stepping on each other. There is no documented contract between the render layer and the data layer beyond "renderAll() reads the current state."
**Suggestions**:
- Add a section describing the "shape of a feature plan" — what a feature must not break (Section 10 rules), which files it is expected to touch, and which entry points (e.g., a `renderXyzTab()` function convention) new features plug into.
- Define a lightweight internal contract between `app.js` and `db.js`/`drive.js` — e.g., "mutations go through `updateAppData(patchFn)` which debounces the IndexedDB write and triggers `renderAll()`" — so parallel feature plans can extend without re-inventing the pattern.
- Suggest a convention for splitting `app.js` once it exceeds a size threshold (e.g., per-tab module files imported via `<script type="module">`) so the monolith has a planned escape valve.

### 14. Overall Coherence & Completeness
**Score: 9.5 / 10** (anchor level: excellent)
**Justification**: The plan is internally consistent across sections: §1's PWA justification is reinforced in §4 (architecture), §6 (security), §7 (testing), §9 (design principles), and §10 (rules). Open questions (Probatorik-Klärung, Multi-Gruppen-Patienten) are explicitly flagged rather than hidden. The document can be navigated top-to-bottom by a feature planner without hitting contradictions. A few minor seams exist: §4.3 mentions `beforeunload` as a trigger but §4.11 lists only `visibilitychange` in the "Mindestanforderungen" row; the "Auto-Load beim Start" in §5.6 says "kein manueller Schritt" while §4.4 notes that the first-ever start will still show an OAuth consent popup — those two should be reconciled explicitly so the §9 "Nullreibung"-Versprechen is honest.
**Suggestions**:
- Reconcile the "Nullreibung beim Start" (§9) promise with the first-run OAuth popup described in §4.4 — clarify that Nullreibung applies from run two onward.
- Move `beforeunload` into the Mindestanforderungen list in §4.11 (or drop it from §4.3 if it's not load-bearing given its best-effort nature).
- Add a "Glossar" at the end (e.g., appData, PiA, PsychThG, Kontingent, Supervisionsverhältnis) so non-domain-expert reviewers can navigate without cross-referencing §2 repeatedly.

## Summary

### Score Overview
| # | Category | Score |
|---|---|---|
| 1 | Usage Context & Platform Fit | 9.8 |
| 2 | Tech Stack Specification | 9.6 |
| 3 | System Architecture & Design | 9.7 |
| 4 | Data Model | 9.5 |
| 5 | Third-Party Dependencies | 9.7 |
| 6 | Error Handling & Resilience Strategy | 8.8 |
| 7 | Security Considerations | 9.0 |
| 8 | Testing Strategy | 9.3 |
| 9 | Observability & Operational Readiness | N/A |
| 10 | Performance & Scalability | 9.0 |
| 11 | Rollout, Migration & Backward Compatibility | 8.8 |
| 12 | MVP Scope Definition | 9.7 |
| 13 | Feature Decomposition Readiness | 9.3 |
| 14 | Overall Coherence & Completeness | 9.5 |

**Average (excluding N/A): 9.4**

### Top 3 Strengths
- Exceptional product-context clarity: target user, target device, regulatory grounding, and the "Nullreibung" design principle are all specific and mutually reinforcing — §1, §2, §9 read as a single coherent argument for why this must be a PWA.
- Non-negotiable rules list in §10 captures the hard invariants (IndexedDB as truth, `drive.appdata` only, `escapeHtml()` always, Base-36 IDs, `duration / 50`, pixel8a-test mandatory) in one enforceable reference — an unusually disciplined move that makes downstream feature plans easier to validate.
- Honest scope discipline: deliberate exclusions in the data model (§3 "Bewusst weggelassen"), explicit Phase 1 vs Phase 2 vs Phase 3 separation in §8, and forthrightness about deferred concerns (conflict resolution, offline queue, rollback) mean reviewers can trust the MVP boundary.

### Top 3 Critical Improvements
- **Harden the error-handling and rollout stories (§6, §11)**: define a Phase 1 Drive retry/backoff contract, a `QuotaExceededError` path, a per-tab render error boundary, and a migration rollback/snapshot strategy — these are the highest-leverage gaps that downstream feature plans will otherwise have to invent per-feature.
- **Raise the security floor with CSP + DSGVO onboarding (§6)**: adopt a baseline CSP meta tag, document the SRI-impossibility tradeoff for Google CDN scripts, take an explicit position on at-rest encryption (out-of-scope-because-X or Phase-2-with-WebCrypto), and require a first-run DSGVO consent screen given the sensitivity of the stored health data.
- **Tighten decomposition contracts (§4, §13)**: add a data-flow diagram, a `updateAppData(patchFn)` mutation convention, and a "what a feature plan may touch" section so that parallel feature plans can extend `app.js` without collisions — this unblocks the next planning phase cleanly.

### Detailed Improvement Suggestions
(See per-category Suggestions blocks above — all categories below 9.5 have actionable bullets: §6 Error Handling, §7 Security, §8 Testing, §10 Performance, §11 Rollout, §13 Feature Decomposition.)

### Open Questions
- Should probatorische Sitzungen count against the 600h Behandlungsstunden-Kontingent, or be a separate bucket? (Plan flags this as "fachlich zu entscheiden" in §8.)
- Multi-Gruppen-Patienten: when a patient belongs to multiple Supervisionsgruppen, which group wins in `openSupervisionModalFor`? (Plan flags this in §8.)
- Does the MVP need any form of at-rest encryption for IndexedDB given health-data sensitivity, or is device-binding + Google-Drive-default-encryption considered sufficient?
- Is `gapi` still required, or can all four Drive REST calls be served by `fetch` + the GIS token, eliminating one CDN dependency?
- What is the acceptance criterion that formally closes Phase 1 and opens Phase 2?

### Readiness Verdict
**needs-iteration** — The plan is strong overall (average 9.4, no blockers, no critical-category below 8.0), but six categories sit below the 9.5 bar for downstream feature planning: Error Handling & Resilience (8.8), Security (9.0), Testing (9.3), Performance (9.0), Rollout & Migration (8.8), and Feature Decomposition Readiness (9.3). Address the per-category suggestions — especially the three top-priority improvements above — and re-run this review before clearing the architecture for feature-level planning.
