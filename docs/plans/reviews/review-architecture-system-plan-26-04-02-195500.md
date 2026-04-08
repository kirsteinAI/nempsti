---
type: architecture-review
plan: system-plan.md
date: 2026-04-02 19:55:00
mode: codebase
reviewer: architecture-plan-reviewer
prior-reviews: 3 (2026-03-30, 2026-04-02 14:29, 2026-04-02 16:36)
verdict: Needs Revision
---

# Architecture Plan Review: Patientenstunden-Tracker (system-plan.md)

## Summary

The architecture plan is well-written and internally consistent for a single-file HTML application. It excels at domain context (PsychThG regulatory background), data model precision, and principled scoping decisions. However, it has three persistent blind spots that three prior reviews have also flagged: no testing strategy section, no security considerations section, and no data schema versioning strategy. The plan also has a naming inconsistency with the codebase and omits several implementation behaviors that are architecturally significant (cascading deletes, full re-render strategy, error handling pattern). The plan is a solid foundation but cannot safely guide downstream feature development until these gaps are closed.

## Overall Rating: Needs Revision

## Critical Issues (Must Address)

- **No Testing Strategy Section**: The plan contains zero mention of testing. The codebase has a mature Playwright E2E test suite: 6 spec files (`dashboard.spec.ts`, `patienten.spec.ts`, `loeschen.spec.ts`, `daten.spec.ts`, `grenzwerte.spec.ts`, `skalierung.spec.ts`), shared helpers (`tests/helpers.ts`), a `test-mapping.json` with direct/indirect test mappings per feature area, and a `playwright.config.ts` targeting 6 device profiles (Chromium, Firefox, WebKit, Pixel 7, iPad gen 7, iPhone 15). A feature developer consulting only this plan would have no guidance on testing requirements or conventions. This is the third consecutive review flagging this gap. -> **Recommended Change**: Add a new "Section 10: Teststrategie" after Section 9, documenting: (1) Playwright as the E2E framework with `@playwright/test ^1.58.2`, (2) the 6 device projects with their rationale, (3) test file naming convention (`tests/<bereich>.spec.ts`), (4) the shared helper pattern in `tests/helpers.ts` (`createPatient`, `createSession`, `openPatientDetail`), (5) the `test-mapping.json` system that maps feature areas to direct/indirect test files, (6) test server setup (`npx serve -l 3123`), (7) the rule that new features must have corresponding test coverage and update `test-mapping.json`.

- **No Security Considerations Section**: The plan does not address security despite the application handling patient therapy data (names, session dates, therapy types). The codebase implements XSS protection via `escapeHtml()` (~20 call sites) using the secure `textContent`-to-`innerHTML` pattern, but the plan neither identifies XSS as a risk nor documents the mitigation as a mandatory convention. The `importData()` function accepts any JSON with `patients` and `sessions` keys and assigns it directly to `appData` without schema or type validation. Patient therapy records are sensitive personal data under DSGVO/GDPR. -> **Recommended Change**: Add a new "Section 11: Sicherheitsaspekte" covering: (1) XSS-Schutz: all user-provided data must be passed through `escapeHtml()` before insertion into innerHTML -- this is a non-negotiable convention for all new features; (2) Import-Validierung: define schema validation rules for JSON import beyond "has patients and sessions arrays" -- validate field types, enum values, reject unexpected properties; (3) Datensensibilitat: acknowledge that JSON export files contain unencrypted patient therapy data and recommend users store exports in secure/encrypted locations; (4) Inline-Handler-Sicherheit: note the `onclick="fn('${id}')"` pattern and its dependency on safe ID generation.

- **No Data Schema Versioning**: The JSON export format has no `version` field. The roadmap (Section 6.4) introduces a new `status` field on Patient. Without a version field, it is impossible to distinguish old exports from new ones during import, and the import function cannot apply correct defaults for missing fields in a principled way. The current import already does ad-hoc patching (`if (!appData.supervisions) appData.supervisions = []`) which will become unmaintainable as the schema evolves. -> **Recommended Change**: (1) Add a `version` field to the `appData` root object (e.g., `"version": 1`). (2) Add a subsection to Section 3 (Datenmodell) titled "Schema-Versionierung" documenting the version contract: the version number increments when fields are added/removed/changed; the import function must check the version and apply migration steps (e.g., `if (version < 2) patient.status = patient.status || 'aktiv'`). (3) Define the current schema as version 1.

## Important Improvements (Should Address)

- **Naming Inconsistency Between Plan and Codebase**: The plan consistently refers to the app as "Patientenstunden-Tracker" but the HTML `<title>` element is "NemPSTi". The header displays "Patientenstunden-Tracker" but the title tag does not match. This was flagged in the first review (2026-03-30) and remains unresolved. -> **Recommended Change**: Either update the `<title>` in the HTML file to match the plan ("Patientenstunden-Tracker"), or document "NemPSTi" as the app's short name in Section 1 and explain the relationship between the two names.

- **Cascading Delete Behavior is Undocumented**: When a patient is deleted, the code (`deletePatient`) removes all associated sessions and cleans the patient ID from all supervision `patientIds` arrays. This is architecturally significant behavior -- it means deleting a patient silently modifies supervision records. The plan does not document this cascade behavior anywhere. -> **Recommended Change**: Add a subsection "Loeschverhalten" to Section 3 (Datenmodell) specifying: "Beim Loschen eines Patienten werden alle zugehorigen Behandlungssitzungen entfernt und die Patienten-ID aus allen Supervisionssitzungen entfernt. Supervisionssitzungen, denen keine Patienten mehr zugeordnet sind, bleiben bestehen (verwaiste Datensatze)." Also note this creates potential orphaned supervision records (supervisions with empty `patientIds` arrays).

- **Full Re-Render Strategy is Undocumented**: Every data mutation calls `renderAll()` which re-renders the entire DOM for all tabs (Dashboard, Patient list, Supervision overview, and the current patient detail if open). This is an important architectural decision that trades simplicity for performance. The plan's Section 9 describes the code structure but not this rendering strategy. -> **Recommended Change**: Add to Section 5 (Architektur) under a new subsection "Rendering-Strategie": "Jede Datenmutation (Anlegen, Bearbeiten, Loschen) lost einen vollstandigen DOM-Neuaufbau aller Ansichten uber `renderAll()` aus. Diese Strategie priorisiert Einfachheit und Korrektheit gegenuber Performance. Fur die erwarteten Datenmengen (10-30 Patienten, bis zu 600+ Sitzungen uber die Ausbildungszeit) ist dies ausreichend performant."

- **Error Handling Pattern is Undocumented**: The codebase follows a consistent pattern: all save operations are wrapped in try/catch blocks that display errors via `showToast()` or inline error divs. This is the application's error handling strategy, but the plan does not document it. -> **Recommended Change**: Add to Section 5 a subsection "Fehlerbehandlung": document the try/catch-to-toast pattern, specify that all user-facing operations must provide visual feedback on both success and failure, and note that validation errors are displayed inline within modals while system errors use toast notifications.

- **Import Validation is Too Permissive**: The `importData()` function accepts any JSON object that has `patients` and `sessions` properties, regardless of whether the data within those arrays is well-formed. A malformed or malicious JSON file could inject unexpected property types, corrupt enums, or add arbitrary properties to `appData`. -> **Recommended Change**: In the proposed Security section and/or in Section 4.6 (Datenmanagement), specify minimum import validation rules: (1) `patients` must be an array of objects each with at least `id` (string) and `name` (string), (2) `sessions` must be an array of objects each with `id`, `patientId`, `date`, `type` (one of the valid enums), and `duration` (positive number), (3) `supervisions` must follow the documented schema, (4) unexpected top-level properties should be stripped.

- **Outdated Line Count Estimates**: Section 9 states "~450 Zeilen" for CSS and "~800 Zeilen" for JavaScript. The actual file is 1693 lines total, with CSS running approximately lines 8-441 (~434 lines) and JavaScript from line 739-1690 (~951 lines). The JS estimate is materially wrong. -> **Recommended Change**: Update the line counts in Section 9 to reflect the current state, or remove specific line counts in favor of "see source file for current extent."

- **Browser Compatibility Constraints Not Specified**: The plan states the app targets "Android-Smartphone und iPad (mobiler Browser)" but does not specify minimum browser versions. The code uses ES6+ features (template literals, arrow functions, `const`/`let`, `Array.from`, async/await, destructuring) and the File System Access API (Chrome/Edge 86+ only, unavailable on Firefox/Safari). This means the "Speicherort wahlen" export feature only works on Chrome. -> **Recommended Change**: Add to Section 1 or Section 5 a "Browser-Kompatibilitat" subsection stating: minimum ES6 support required (Chrome 51+, Safari 10+, Firefox 54+); File System Access API is Chrome/Edge-only and gracefully degrades; specify whether "iPad" means Safari or Chrome on iPad.

## Minor Suggestions (Nice to Have)

- **Deprecated `substr()` in ID Generation**: The `generateId()` function uses `String.prototype.substr()` which is deprecated in favor of `substring()` or `slice()`. This is a minor long-term maintenance concern. -> **Recommended Change**: Update Section 5's ID generation code snippet to use `.substring(2, 7)` instead of `.substr(2, 5)`, and update the actual code accordingly.

- **Missing Roadmap Prioritization**: Roadmap items 6.1-6.4 have no relative priority. Section 6.5 is labeled "niedrigere Prioritat" but the items before it are unordered. -> **Recommended Change**: Add a brief priority note to each roadmap subsection (e.g., "Prioritat: hoch / mittel / niedrig") or order them explicitly by planned implementation sequence.

- **Session Type `probatorik` is Inconsistent with Contingent Model**: Probatorische Sitzungen (trial sessions) typically do not count against the therapy contingent (Kontingent) in real-world PsychThG practice, but the code counts all sessions equally toward the contingent progress bar regardless of type. The plan does not address whether probatorik sessions should be excluded from contingent calculations. -> **Recommended Change**: Add a note to Section 3 (Behandlungssitzung) or Section 4.3 clarifying whether probatorische Sitzungen count toward the Kontingent or should be tracked separately. If they should be excluded, document this as a future improvement.

- **Supervision Group Auto-Detection Picks First Match Only**: When opening a supervision modal from a patient detail view (`openSupervisionModalFor`), the code selects the first matching group. If a patient belongs to multiple groups, only the first is selected. The plan does not address this edge case. -> **Recommended Change**: Add a note to Section 4.4 or Section 3 (Supervisionsgruppe) acknowledging that a patient can belong to multiple groups and documenting the behavior when opening supervision from patient detail.

- **No Accessibility Considerations**: The plan does not mention accessibility (a11y). The codebase uses semantic HTML elements in some places but also relies heavily on `onclick` handlers on `<div>` elements (e.g., `patient-item` divs) which are not keyboard-navigable. -> **Recommended Change**: Add a brief note to Section 7 (Designprinzipien) acknowledging the current a11y status and whether it is a future consideration.

## Missing Sections or Topics

1. **Testing Strategy** (critical -- see above)
2. **Security Considerations** (critical -- see above)
3. **Data Schema Versioning** (critical -- see above)
4. **Browser Compatibility Matrix** (important)
5. **Error Handling Strategy** (important)
6. **Cascading Delete / Referential Integrity Rules** (important)
7. **Rendering Strategy** (important)
8. **Accessibility Considerations** (minor)
9. **Distribution / Update Strategy** -- how do users receive new versions of the HTML file?
10. **Constraints & Non-Negotiables Summary** -- a reference section listing all hard rules that feature plans must respect (single file, no localStorage, no external deps, escapeHtml on all user data, no form elements, no alert/confirm, etc.)

## Strengths

- **Exceptional domain context**: Section 2 (Regulatorischer Hintergrund) provides precise PsychThG requirements including the 1:4 supervision ratio, contingent structures, and supervision group mechanics. This gives any feature developer the regulatory context they need without external research.

- **Precise and verified data model**: The four entity tables (Patient, Session, Supervision, SupervisionGroup) are clearly specified with types, required status, and descriptions. The "Kernmechanik" explanation for supervision multi-patient assignment is unambiguous. The actual codebase `appData` structure matches the plan exactly.

- **Disciplined scoping**: The explicit "Bewusst weggelassen" note in the Patient model and the clear separation between v1 (Section 4) and roadmap (Section 6) demonstrate thoughtful MVP scoping. The roadmap items include "Technische Umsetzung" notes that make them implementable.

- **Thorough sandbox hardening documentation**: Section 5's "Bekannte Einschrankungen" covers five specific sandbox issues with their workarounds. The codebase implements all of them. This is practical, battle-tested knowledge that prevents future regressions.

- **Three-tier export fallback**: The File System Access API -> download -> textarea copy fallback chain is well-designed and documented, addressing real-world browser API availability gaps gracefully.

- **Well-structured codebase alignment**: The plan's description of the HTML file's internal structure (Section 9) maps cleanly to the actual code organization, making it useful as a navigation guide.

## Specific Text/Section Amendments

### Section 1: Add "Namensgebung" subsection after "Technologieentscheidung"

```markdown
### Namensgebung
Die Anwendung traegt den Kurznamen **NemPSTi** (im HTML-Titel) und den beschreibenden Namen **Patientenstunden-Tracker** (im Header und in dieser Dokumentation).
```

### Section 3: Add "Schema-Versionierung" subsection at the end

```markdown
### Schema-Versionierung

Das exportierte JSON-Format enthaelt ein `version`-Feld auf Root-Ebene:

| Feld | Typ | Beschreibung |
|---|---|---|
| `version` | number | Schema-Version (aktuell: 1) |

**Migrationsregeln beim Import**:
- Fehlt `version`: als Version 0 behandeln, Defaults setzen fuer `supervisions`, `supervisionGroups`, `settings`
- Version < aktuelle Version: fehlende Felder mit Defaults ergaenzen (z.B. `patient.status = 'aktiv'` ab Version 2)
- Version > aktuelle Version: Warnung anzeigen, Import trotzdem zulassen (unbekannte Felder ignorieren)
```

### Section 3: Add "Loeschverhalten / Referenzielle Integritaet" subsection

```markdown
### Loeschverhalten / Referenzielle Integritaet

| Aktion | Kaskade |
|---|---|
| Patient loeschen | Alle zugehoerigen Sessions werden entfernt. Patient-ID wird aus allen Supervisions-`patientIds` entfernt. |
| Session loeschen | Nur die Session wird entfernt. Keine Kaskade. |
| Supervision loeschen | Nur die Supervision wird entfernt. Keine Kaskade. |
| Supervisionsgruppe loeschen | Nur die Gruppe wird entfernt. Bestehende Supervisionen behalten ihre Patientenzuordnungen. |

**Hinweis**: Nach dem Loeschen eines Patienten koennen Supervisionssitzungen mit leeren `patientIds`-Arrays entstehen (verwaiste Datensaetze). Diese werden aktuell nicht automatisch bereinigt.
```

### Section 5: Add "Rendering-Strategie" subsection after "UI-Architektur"

```markdown
### Rendering-Strategie
Jede Datenmutation (Anlegen, Bearbeiten, Loeschen) loest ueber `renderAll()` einen vollstaendigen DOM-Neuaufbau aller Ansichten aus (Dashboard, Patientenliste, Supervisionsuebersicht). Ist die Patientendetailansicht geoeffnet, wird auch diese neu gerendert. Diese Strategie priorisiert Einfachheit und Zuverlaessigkeit gegenueber Performance-Optimierung und ist fuer die erwarteten Datenmengen (10-30 Patienten, bis zu ~800 Sitzungen ueber eine vollstaendige Ausbildung) ausreichend performant.
```

### Section 5: Add "Fehlerbehandlung" subsection

```markdown
### Fehlerbehandlung
- **Speichern-Operationen**: Alle Save-Funktionen sind in `try/catch` gewrappt. Fehler werden ueber `showToast(message, 'danger')` angezeigt.
- **Validierungsfehler**: Werden innerhalb der Modals als Inline-Fehlermeldungen angezeigt (z.B. fehlender Patientenname).
- **Erfolgsrueckmeldungen**: Jede erfolgreiche Aktion zeigt einen gruenen Toast (`showToast(message, 'success')`).
- **Import-Fehler**: Ungueltige JSON-Dateien werden mit einer Fehlermeldung abgelehnt.
```

### Section 5: Add "Browser-Kompatibilitaet" subsection

```markdown
### Browser-Kompatibilitaet
Die App setzt mindestens ES6-Unterstuetzung voraus (Template Literals, Arrow Functions, `const`/`let`, `Array.from`, `async`/`await`). Unterstuetzte Browser:

| Browser | Mindestversion | Hinweis |
|---|---|---|
| Chrome (Android/Desktop) | 51+ | Volle Funktionalitaet inkl. File System Access API |
| Safari (iPad/iPhone) | 10+ | Export ohne Speicherort-Wahl (Fallback auf Download) |
| Firefox | 54+ | Export ohne Speicherort-Wahl (Fallback auf Download) |

Die File System Access API (nativer "Speichern unter"-Dialog) ist ausschliesslich in Chrome/Edge 86+ verfuegbar. Auf allen anderen Browsern greift der Fallback-Mechanismus (Download bzw. Textarea-Kopie).
```

### New Section 10: Teststrategie

```markdown
## 10. Teststrategie

### Framework & Setup
- **Framework**: Playwright (`@playwright/test ^1.58.2`) fuer End-to-End-Tests
- **Testserver**: `npx serve -l 3123` (automatisch via Playwright `webServer`-Config)
- **Testverzeichnis**: `tests/`

### Geraeteabdeckung
Tests laufen gegen 6 Browser-/Geraeteprofile:

| Projekt | Geraet | Zweck |
|---|---|---|
| chromium | Desktop Chrome | Hauptbrowser, File System Access API |
| firefox | Desktop Firefox | Cross-Browser-Kompatibilitaet |
| webkit | Desktop Safari | WebKit-Engine-Kompatibilitaet |
| pixel7 | Pixel 7 (Android) | Primaeres Mobile-Zielgeraet |
| ipad-gen7 | iPad (gen 7) | Tablet-Nutzung |
| iphone15 | iPhone 15 | iOS Safari-Kompatibilitaet |

### Testdateien & Konventionen
- **Namenskonvention**: `tests/<bereich>.spec.ts`
- **Shared Helpers**: `tests/helpers.ts` stellt wiederverwendbare Funktionen bereit (`createPatient`, `createSession`, `openPatientDetail`)
- **Feature-Zuordnung**: `test-mapping.json` ordnet App-Bereiche ihren direkten und indirekten Testdateien zu

### Bestehende Testbereiche

| Testdatei | Bereich |
|---|---|
| `dashboard.spec.ts` | Dashboard, Navigation, FAB-Button |
| `patienten.spec.ts` | Patienten-CRUD, Sitzungen, Supervision |
| `loeschen.spec.ts` | Loesch-Funktionen, Bestaetigungsdialoge |
| `daten.spec.ts` | Export, Import, Einstellungen |
| `grenzwerte.spec.ts` | Grenzwerte, Validierung, XSS |
| `skalierung.spec.ts` | Performance bei groesseren Datenmengen |

### Regeln fuer neue Features
- Jedes neue Feature muss durch mindestens einen E2E-Test abgedeckt sein
- `test-mapping.json` muss aktualisiert werden, wenn neue Features oder Testdateien hinzukommen
- Tests muessen auf allen 6 Geraeteprofilen bestehen
```

### New Section 11: Sicherheitsaspekte

```markdown
## 11. Sicherheitsaspekte

### XSS-Schutz
Die App rendert Benutzerdaten (Patientennamen, Notizen, Supervisornamen) innerhalb von `innerHTML`-Zuweisungen. Zum Schutz vor Cross-Site-Scripting wird die Funktion `escapeHtml()` verwendet, die den sicheren `textContent`-zu-`innerHTML`-Mechanismus nutzt.

**Pflicht fuer alle neuen Features**: Jeder vom Benutzer eingegebene String muss vor der Einfuegung in innerHTML durch `escapeHtml()` geleitet werden. Es gibt keine Ausnahmen.

### Import-Validierung
Die Import-Funktion muss sicherstellen, dass importierte JSON-Daten dem erwarteten Schema entsprechen:
- `patients`: Array von Objekten mit mindestens `id` (string) und `name` (string)
- `sessions`: Array von Objekten mit `id`, `patientId`, `date`, `type` (gueltige Enum-Werte), `duration` (positive Zahl)
- `supervisions`: Array von Objekten gemaess dokumentiertem Schema
- Unbekannte Top-Level-Eigenschaften werden ignoriert

### Datensensibilitaet
Die JSON-Exportdateien enthalten **unverschluesselte** Patientendaten (Namen, Therapiezeitraeume, Sitzungsdaten). Diese Daten sind personenbezogen und potentiell gesundheitsbezogen im Sinne der DSGVO. Nutzer sollten darauf hingewiesen werden, Exportdateien an einem sicheren Ort aufzubewahren und nicht ueber unsichere Kanaele zu teilen.

### Inline-Event-Handler
Die App verwendet `onclick="fn('${id}')"` mit Template-Literal-Interpolation. Die Sicherheit dieses Patterns haengt davon ab, dass die ID-Generierung (`generateId()`) ausschliesslich alphanumerische Zeichen erzeugt. Dies ist aktuell gewaehrleistet (Base-36-Kodierung).
```

### Section 9: Update line count estimates

Replace:
```
│   └── <style>        ← Gesamtes CSS (~450 Zeilen)
...
└── <script>             ← Gesamtes JavaScript (~800 Zeilen)
```

With:
```
│   └── <style>        ← Gesamtes CSS (~430 Zeilen)
...
└── <script>             ← Gesamtes JavaScript (~950 Zeilen)
```
