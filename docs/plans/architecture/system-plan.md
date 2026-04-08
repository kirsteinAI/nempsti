# Patientenstunden-Tracker (NemPSTi) — Tech. Concept

## 1. Projektübersicht

### Zweck
Der Patientenstunden-Tracker ist eine **installierbare Progressive Web App (PWA)** für Psychotherapeut:innen in Ausbildung (PP-Ausbildung nach PsychThG). Sie dient der Dokumentation und Überwachung von Behandlungsstunden und Supervisionsstunden pro Patient, um die Einhaltung der gesetzlichen Supervisionsvorgaben sicherzustellen.

### Zielgruppe
Psychologische Psychotherapeut:innen in Ausbildung (PiA), die ihre ambulanten Behandlungsstunden und zugehörigen Supervisionsstunden nachhalten müssen.

### Namensgebung
- **Kurzname / Paket-/Repo-Name / PWA-`short_name`**: **NemPSTi**
- **Beschreibender Name / Header / PWA-`name`**: **Patientenstunden-Tracker**

### Nutzungskontrakt (Phase 1)
**Ein Gerät, ein Nutzer, ein Google-Drive-Konto.** Phase 1 nimmt explizit keine parallelen Geräte, keine Mehrbenutzer und keine Kontowechsel an. Diese Annahmen gelten bis Phase 3 (Multi-Device, §12).

### Erwartetes Nutzungsmuster
- **Session-Länge**: kurze Interaktionen (typisch 30 Sekunden bis 3 Minuten)
- **Frequenz**: mehrmals pro Woche, meist direkt nach einem Behandlungstermin
- **Häufigster Flow**: App öffnen → Patient auswählen → Sitzung mit heutigem Datum hinzufügen → App schließen

Diese Muster definieren das UI-Reibungsbudget für alle Feature-Pläne: **Jede zusätzliche Sekunde oder jeder zusätzliche Tap im Haupt-Flow ist ein hartes Rechtfertigungs-Argument wert.**

### Primäres Zielgerät
**Google Pixel 8a**, Chrome für Android, installiert als PWA auf dem Homescreen. iPad/Desktop-Browser werden als sekundäre Ziele unterstützt, aber Pixel 8a ist das **Pflicht-Profil** in allen Tests.

### Technologieentscheidung
Multi-file Progressive Web App, gehostet auf **GitHub Pages** (HTTPS), mit:

- **IndexedDB** als primärem lokalen Datenspeicher (automatisches Laden beim Start, kein manueller Import mehr)
- **Google Drive API** (`drive.appdata`-Scope, `appDataFolder`) als automatischem Cloud-Backup
- **Service Worker** für vollständigen Offline-Betrieb
- **Web App Manifest** für Installation auf dem Homescreen

**Warum nicht Single-File-HTML?** Die ursprüngliche Architektur verlangte bei jedem Start einen manuellen JSON-Ladevorgang und vor dem Schließen einen manuellen Export. Auf einem Smartphone inakzeptabel. Die PWA eliminiert diesen Reibungspunkt.

**Was aus der Single-File-Ära bleibt**: Zero-Server, Zero-Build (vanilla HTML/CSS/JS, kein Bundler), Zero-Runtime-Dependencies außer der Google Identity Services (GIS) Library vom Google-CDN. JSON-Export/Import bleibt als Escape-Hatch und als Migrationspfad von der Legacy-Single-File-HTML.

---

## 2. Regulatorischer Hintergrund

### PsychThG-Ausbildung — Standardvorgaben

| Baustein | Mindeststunden |
|---|---|
| Behandlungsstunden (ambulant) | 600 |
| Supervisionsstunden | 150 |
| Supervisionsverhältnis | mind. 1 Supervisionsstunde pro 4 Behandlungsstunden (1:4) |
| Theoretische Ausbildung | 600 |
| Selbsterfahrung | 120 |

### Therapieverfahren-Kontingente (Verhaltenstherapie)

| Bewilligungsform | Stunden |
|---|---|
| Kurzzeit 1 | 12 |
| Kurzzeit 2 | 24 |
| Langzeit | 60 |
| Verlängerung | variabel |

### Supervision — Praxisrelevante Details
- Supervision erfolgt in der Regel als **Gruppensupervision**
- Mehrere Patienten werden häufig **kombiniert in einer Supervisionssitzung** besprochen
- Patienten sind festen **Supervisionsgruppen** zugeordnet
- Eine Supervisionsstunde = 50 Minuten (analog Behandlungsstunde)

---

## 3. Datenmodell

### Übersicht

```
appData
├── version            (Schema-Version, aktuell: 1)
├── settings
│   ├── supervisionRatio (Standard: 4)
│   └── defaultKontingent (Standard: 60)
├── patients[]
├── sessions[]
├── supervisions[]
└── supervisionGroups[]
```

Das gesamte `appData`-Objekt wird als **ein einziger Record** in IndexedDB unter dem Key `'appData'` gespeichert. Beim Drive-Backup wird derselbe Record als JSON-Datei `nempsti-data.json` im `appDataFolder` abgelegt.

### Format-Konventionen (gelten für alle Entitäten)

| Feld-Typ | Format | Beispiel |
|---|---|---|
| `id` | Base-36 alphanumerisch, 10–16 Zeichen, Format: `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}` | `"m3k7l2p9aq4xz"` |
| `date` (Kalenderdatum) | ISO 8601 `YYYY-MM-DD`, lokale Kalenderdaten, **keine Zeitzone**, keine Uhrzeit | `"2026-04-08"` |
| `duration` | Positive Ganzzahl, Minuten | `50` |
| `string`-Felder | UTF-8, maximal 500 Zeichen (Validierung bei Eingabe + Import) | `"Max Mustermann"` |

Diese Formate sind verbindlich und werden in `validation.js` als Konstanten zentral definiert.

### Patient

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string (Base-36) | auto | Eindeutige ID |
| `name` | string | ja | Name des Patienten |
| `kuerzel` | string | nein | Kürzel / Initialen (z.B. "MM") |
| `kontingent` | number | ja | Bewilligtes Stundenkontingent (Default: 60) |
| `startDate` | string (ISO `YYYY-MM-DD`) | nein | Therapiebeginn |

**Bewusst weggelassen**: Diagnose (ICD-10), Therapieverfahren, Bewilligungsstatus, Notizen. Können später optional ergänzt werden (Roadmap §12).

### Behandlungssitzung (Session)

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string (Base-36) | auto | Eindeutige ID |
| `patientId` | string | ja | Referenz auf Patient |
| `date` | string (ISO `YYYY-MM-DD`) | ja | Datum der Sitzung |
| `type` | enum | ja | `einzel`, `doppel`, `gruppe`, `probatorik` |
| `duration` | number | ja | Dauer in Minuten (Default: 50) |
| `note` | string | nein | Optionale Notiz |

**Stundenberechnung**: `duration / 50` = Anzahl Behandlungsstunden.

### Supervisionssitzung

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string (Base-36) | auto | Eindeutige ID |
| `patientIds` | string[] | ja | Referenz auf einen oder mehrere Patienten |
| `date` | string (ISO `YYYY-MM-DD`) | ja | Datum der Supervision |
| `type` | enum | ja | `einzel`, `gruppe` |
| `duration` | number | ja | Dauer in Minuten (Default: 50) |
| `supervisor` | string | nein | Name des Supervisors |
| `note` | string | nein | Optionale Notiz |

**Kernmechanik**: Eine Supervisionssitzung kann mehreren Patienten gleichzeitig zugeordnet werden. Die vollen Supervisionsstunden werden jedem zugeordneten Patienten angerechnet.

### Supervisionsgruppe

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string (Base-36) | auto | Eindeutige ID |
| `name` | string | ja | Gruppenname |
| `supervisor` | string | nein | Standard-Supervisor für diese Gruppe |
| `patientIds` | string[] | ja | Patienten in dieser Gruppe |

### Invarianten

Feature-Pläne und Migrationen müssen diese Invarianten bewahren:

1. Es existiert **genau ein** `appData`-Record in IndexedDB mit Key `'appData'`.
2. `appData.version` ist eine positive Ganzzahl.
3. `id` ist innerhalb jeder Collection (`patients`, `sessions`, `supervisions`, `supervisionGroups`) **eindeutig**.
4. Jede `session.patientId` verweist auf ein existierendes `patients[i].id` (referenzielle Integrität, außer während Migrationen).
5. `supervision.patientIds` ist ein Array (darf leer sein — verwaiste Supervisionen sind erlaubt); nicht-leere Einträge verweisen auf existierende Patienten.
6. `supervisionGroup.patientIds` verweist auf existierende Patienten.
7. Alle `date`-Felder folgen ISO `YYYY-MM-DD`.
8. Alle `duration`-Felder sind positive Zahlen.

### Kanonisches Beispiel (Schema v1)

```json
{
  "version": 1,
  "settings": {
    "supervisionRatio": 4,
    "defaultKontingent": 60
  },
  "patients": [
    {
      "id": "m3k7l2p9aq4xz",
      "name": "Max Mustermann",
      "kuerzel": "MM",
      "kontingent": 60,
      "startDate": "2026-01-15"
    }
  ],
  "sessions": [
    {
      "id": "m3k7l9x1bt8kw",
      "patientId": "m3k7l2p9aq4xz",
      "date": "2026-04-08",
      "type": "einzel",
      "duration": 50,
      "note": ""
    }
  ],
  "supervisions": [
    {
      "id": "m3k7mab2cu7nr",
      "patientIds": ["m3k7l2p9aq4xz"],
      "date": "2026-04-07",
      "type": "gruppe",
      "duration": 50,
      "supervisor": "Dr. Müller",
      "note": ""
    }
  ],
  "supervisionGroups": [
    {
      "id": "m3k7mcd4dv6os",
      "name": "Dienstags-SV Dr. Müller",
      "supervisor": "Dr. Müller",
      "patientIds": ["m3k7l2p9aq4xz"]
    }
  ]
}
```

Dieses Beispiel dient als Test-Fixture und Referenz-Shape für alle Feature-Pläne.

### Schema-Versionierung

Aktuelle Version: **1**. Migrationen sind **append-only**: einmal released, darf eine Migration nie editiert oder umsortiert werden (sonst laufen bereits migrierte Clients erneut).

**Migrationsregeln beim Laden** (IndexedDB, Drive-Restore, oder JSON-Import — identisch in allen drei Pfaden):

- Fehlt `version`: als Version 0 behandeln → Migration auf 1 (Defaults für `supervisions`, `supervisionGroups`, `settings` setzen)
- `version < CURRENT_VERSION`: Migrationen sequenziell anwenden
- `version === CURRENT_VERSION`: Keine Migration, direkt verwenden
- `version > CURRENT_VERSION`: Laden **ablehnen**, Nutzer zum App-Update auffordern (siehe §10.5)

Migrationen werden zentral in `migrations.js` als Array `MIGRATIONS[]` mit `{ from: n, to: n+1, up: (data) => newData }` implementiert. Jede Migration ist eine reine Funktion ohne Seiteneffekte und ist **transaktional**: wirft sie einen Fehler, wird der Prä-Migrations-Snapshot als Rollback-Punkt beibehalten (siehe §10.3).

### Löschverhalten / Referenzielle Integrität

| Aktion | Kaskade |
|---|---|
| Patient löschen | Alle zugehörigen Sessions werden entfernt. Patient-ID wird aus allen `supervision.patientIds` entfernt. Patient-ID wird aus allen `supervisionGroup.patientIds` entfernt. |
| Session löschen | Nur die Session wird entfernt. |
| Supervision löschen | Nur die Supervision wird entfernt. |
| Supervisionsgruppe löschen | Nur die Gruppe wird entfernt. Bestehende Supervisionen behalten ihre Patientenzuordnungen. |

**Hinweis**: Supervisionssitzungen mit leeren `patientIds`-Arrays (verwaiste Datensätze) sind zulässig, werden aber in der Supervisionsübersicht markiert.

---

## 4. Architektur

### 4.1 Stack

- **HTML5 + CSS3 + Vanilla JavaScript (ES2020+)** als ES-Module (`<script type="module">`)
- **Keine Frameworks, kein Bundler, kein Build-Step**
- **Einzige externe Runtime-Abhängigkeit**: Google Identity Services (`https://accounts.google.com/gsi/client`) — wird direkt vom Google-CDN geladen
- **Drive-API-Aufrufe** verwenden ausschließlich `fetch()` mit dem GIS-Access-Token (kein `gapi.client`, kein zweites CDN-Script)
- **IndexedDB**-Zugriff über die **rohe** `indexedDB`-Browser-API. Keine Wrapper (kein `idb`, kein `dexie`) — das hält `db.js` klein und dependency-frei.
- **Hosting**: GitHub Pages (HTTPS) unter `https://<user>.github.io/nempsti/`
- **Node-Version für lokalen Testserver & CI**: Node 20 LTS oder neuer (`npx serve -l 3123`)

### 4.2 Dateistruktur

```
/  (GitHub Pages root)
├── index.html              App-Shell, lädt state/db/drive/migrations/app als ES-Module
├── styles.css              Gesamtes Styling
├── state.js                appData-Singleton + updateAppData(patchFn)-Kontrakt
├── db.js                   IndexedDB-Wrapper (rohe IDB-API, load/save)
├── drive.js                Drive API via fetch + GIS (auth, backup, restore)
├── migrations.js           Schema-Migrationen (append-only Array)
├── validation.js           escapeHtml, Import-Validator, Format-Konstanten
├── render.js               renderAll + tab-spezifische Render-Funktionen
├── app.js                  Event-Handler, Modals, Initialisierung
├── sw.js                   Service Worker (Offline-Cache)
├── manifest.webmanifest    PWA-Manifest
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md
```

**Warum diese Aufteilung**: Jedes Modul hat eine klare Verantwortung und einen klaren Abhängigkeitsgraph. Das verhindert den Monolith-Problemfall, bei dem mehrere parallele Feature-Pläne in einer einzigen Datei kollidieren (siehe §16 Feature-Plan-Vertrag).

### 4.3 Datenfluss-Diagramm

```
  ┌───────────────────────────────────────────────────────────┐
  │                       app.js                              │
  │  (Event-Handler, Modals, Init)                            │
  │                                                           │
  │   user action ─────┐                                      │
  │                    ▼                                      │
  │         updateAppData(patchFn)  ◄───── einziger           │
  │                    │                   Mutations-         │
  │                    │                   Einstiegspunkt     │
  └────────────────────┼──────────────────────────────────────┘
                       │
                       ▼
  ┌───────────────────────────────────────────────────────────┐
  │                      state.js                             │
  │  let appData = { ... }   // singleton, module-level       │
  │                                                           │
  │  updateAppData(patchFn):                                  │
  │    1. patchFn(appData)            // mutate in-place      │
  │    2. render.renderAll()          // re-render UI         │
  │    3. db.scheduleWrite(appData)   // debounced 300ms      │
  │    4. markDriveDirty()            // flag for next flush  │
  └──────────┬────────────────┬────────────────────┬──────────┘
             │                │                    │
             ▼                ▼                    ▼
  ┌─────────────────┐ ┌───────────────┐  ┌─────────────────┐
  │   render.js     │ │    db.js      │  │    drive.js     │
  │  renderAll()    │ │ loadAppData() │  │  authenticate() │
  │  renderDash()   │ │ saveAppData() │  │  backupNow()    │
  │  renderPatients │ │ clearAll()    │  │  restore()      │
  │  ...            │ │               │  │  (fetch+GIS)    │
  └─────────────────┘ └───────┬───────┘  └────────┬────────┘
                              │                   │
                              ▼                   ▼
                      ┌────────────┐       ┌──────────────┐
                      │ IndexedDB  │       │ Drive        │
                      │ (local)    │       │ appDataFolder│
                      └────────────┘       └──────────────┘
                              ▲                   ▲
                              │                   │
                              └── migrations.js ──┘
                                (applied on load,
                                 BEFORE commit to state)
```

**Wichtig**:
- **`state.js` besitzt `appData`**. Kein anderes Modul hält eine Referenz. Leser können `getAppData()` nutzen (liefert eingefrorene Kopie für Rendering).
- **`updateAppData(patchFn)` ist der einzige Mutations-Einstiegspunkt**. Direkte Mutationen von außerhalb sind verboten (Regel §15).
- **Migrationen laufen auf geladenen Payloads _bevor_ der Payload zur in-memory `appData` wird**, unabhängig davon, ob der Payload aus IDB, Drive oder JSON-Import stammt.
- **Debounce-Clock gehört `db.js`**. `state.js` ruft nur `scheduleWrite()`.

### 4.4 Persistenz-Architektur

**Zwei-Schichten-Modell**:

#### Schicht 1: IndexedDB (primär, lokal)
- Ein Object Store `appState`, Key `'appData'`, Value = das gesamte `appData`-Objekt
- **Laden**: synchron nach DOMContentLoaded, noch vor dem ersten Render
- **Schreiben**: debounced auf 300ms nach jeder Mutation
- **Datenverlust-Budget**: max. 300ms bei Hard-Crash = akzeptabel

#### Schicht 2: Google Drive `appDataFolder` (Backup, Cloud)
- Scope: `drive.appdata` → die Datei ist in der Drive-UI des Nutzers **unsichtbar** und pro App gescoped
- Dateiname: `nempsti-data.json`
- **Auto-Sync-Trigger**:
  - `visibilitychange` → `document.visibilityState === 'hidden'`
  - Manueller Button "Jetzt sichern" in den Einstellungen
- **`beforeunload` wird _nicht_ als Trigger verwendet**, weil er auf Mobile-Browsern unzuverlässig feuert und keine async Drive-Calls mehr durchlässt. `visibilitychange` ist der verlässliche mobile Ersatz.
- **Nicht** bei jeder Mutation (Phase 1). Das ist Phase 2.
- **Beim App-Start**: wenn IndexedDB leer ist (neues Gerät, Browser-Daten gelöscht), wird automatisch aus Drive restauriert.

#### Konfliktauflösung
- **Phase 1**: keine. Single-Device-Annahme (§1 Nutzungskontrakt). Wenn IDB nicht leer ist, gewinnt IDB. Wenn IDB leer und Drive gefüllt: Drive-Restore.
- **Phase 2/3**: siehe Roadmap §12.

#### Quota-Kontext
Der `drive.appdata`-Bereich zählt gegen das normale 15-GB-Drive-Quota des Nutzers. Bei den erwarteten Datenmengen (~800 Sessions + 30 Patienten über die gesamte Ausbildung ≈ **<100 KB**, siehe §9) ist Quota kein praktischer Faktor.

### 4.5 Google Drive Integration

**Auth**: Google Identity Services (GIS) Token Client mit `drive.appdata`-Scope.
- Erstlauf: Consent-Popup
- Access Token läuft nach ~1 Stunde ab → stilles Re-Auth via `prompt: ''`
- Auth-Fehler: App arbeitet rein lokal weiter; Status-Indikator "Backup inaktiv" + Retry-Button

**API-Calls (fetch-basiert, kein gapi)**:

| Operation | Endpoint | Zweck |
|---|---|---|
| List | `GET /drive/v3/files?spaces=appDataFolder&q=name='nempsti-data.json'` | Prüfen ob Backup existiert |
| Create | `POST /upload/drive/v3/files?uploadType=multipart` | Neues Backup anlegen |
| Update | `PATCH /upload/drive/v3/files/{id}?uploadType=multipart` | Existierendes Backup überschreiben |
| Download | `GET /drive/v3/files/{id}?alt=media` | Backup herunterladen für Restore |

Header: `Authorization: Bearer <gis-access-token>`. Fehlerbehandlung siehe §7.2.

**Client-ID**: wird als Konstante in `drive.js` (`GOOGLE_CLIENT_ID`) hinterlegt und ins öffentliche Repo committed. Browser-OAuth-Client-IDs sind per Google-Design kein Geheimnis.

**Was passiert bei Kontosperrung / Client-Revocation**: Der Token-Request schlägt fehl. Die App zeigt im Settings-Tab einen Fehlerzustand "Drive-Backup nicht verfügbar — App läuft lokal weiter, bitte JSON-Export nutzen" und deaktiviert Auto-Backup-Trigger. Alle lokalen Features bleiben funktional.

### 4.6 Service Worker / Offline-Strategie

- **Cache-Name**: `nempsti-v<CACHE_VERSION>` — `CACHE_VERSION` ist ein Konstante in `sw.js`, wird bei jedem Release inkrementiert
- **Cache-First** für App-Shell (`index.html`, `styles.css`, alle `.js`-Module, Icons, Manifest)
- **Network-First mit Cache-Fallback** für GIS (`accounts.google.com/gsi/client`)
- **Network-Only** (niemals cached) für Drive API Calls (`www.googleapis.com/drive/v3/*`)
- **Update-Check**: Beim App-Start registriert der SW `updatefound` und zeigt einen Toast "Neue Version verfügbar — neu laden?" wenn eine neue Version bereitsteht
- **Stale-Client-Grenze**: Wenn der aktuelle SW älter als **14 Tage** ist (tracked über `lastActivatedAt` im SW selbst), erzwingt der SW beim nächsten Start einen Hard-Reload statt auf den Toast zu warten (siehe §10.4)

### 4.7 PWA-Manifest

`manifest.webmanifest`:
- `name: "Patientenstunden-Tracker"`, `short_name: "NemPSTi"`
- `start_url: "./"`, `display: "standalone"`, `orientation: "portrait"`
- `theme_color`, `background_color` passend zum CSS
- `icons`: 192px + 512px + 512px-maskable (für Android Adaptive Icons)

Auf Pixel 8a: nach erstem Besuch "Zur Startseite hinzufügen"-Prompt → Launcher öffnet App fullscreen.

### 4.8 UI-Architektur

- **Tab-basierte Navigation**: Dashboard, Patienten, Supervision, Gruppen, Daten
- **Modal-Pattern**: Bottom-Sheet-Modals für Eingabeformulare (mobile-optimiert)
- **Custom Dialogs**: Eigene Bestätigungs-Dialoge und Toast-Benachrichtigungen (kein `alert()`/`confirm()`)
- **Form-Elemente erlaubt**: `<form>` darf verwendet werden (Sandbox-Einschränkung entfällt mit PWA)
- **Responsive Design**: Mobile-first, primär für Pixel 8a (412×915 CSS-Pixel)

### 4.9 Rendering-Strategie

Jede Datenmutation ruft `renderAll()`, das den vollständigen DOM aller sichtbaren Ansichten neu aufbaut. Das priorisiert Einfachheit/Korrektheit über Performance und ist für den erwarteten Datenbereich ausreichend (siehe §9 für harte Budgets und den Worst-Case-Schwellenwert für inkrementelles Rendering).

**Render-Fehler-Isolation**: `renderAll()` ruft jede Tab-Render-Funktion (`renderDashboard`, `renderPatientList`, etc.) in einem **eigenen try/catch** auf. Wirft ein Tab-Renderer, wird der betroffene Tab-Container mit einem Fehler-Fallback-Shell ersetzt ("Fehler in diesem Bereich — JSON-Export nutzen und Admin kontaktieren"). Andere Tabs rendern normal. Kein White-Screen durch einzelne fehlerhafte Records.

### 4.10 ID-Generierung

```javascript
Date.now().toString(36) + Math.random().toString(36).substring(2, 7)
```

Base-36-Kodierung, ausschließlich alphanumerisch — sicher für Interpolation in `onclick`-Handler-Strings. Länge typisch 13–14 Zeichen.

### 4.11 Browser-Kompatibilität

| Browser | Mindestversion | Status |
|---|---|---|
| Chrome für Android (Pixel 8a) | 120+ | **Primäres Zielgerät** — volle PWA-Installation, IndexedDB, Drive API |
| Chrome Desktop | 120+ | Voll unterstützt |
| Safari iOS (iPad/iPhone) | 16.4+ | PWA-Installation via "Zum Home-Bildschirm", IndexedDB + Drive API funktionieren |
| Firefox | 120+ | IndexedDB + Drive API funktionieren, PWA-Installation eingeschränkt |

**Web-API-Mindestanforderungen**: ES2020, IndexedDB, Service Worker, Fetch, `visibilitychange`, ES-Modules im Browser (`<script type="module">`), WebCrypto (für künftige Encryption-Option).

**Nullreibung-Reconciliation**: Die Nullreibung-Versprechung (§14) gilt **ab dem zweiten Start**. Der allererste Start zeigt einmalig den Google-OAuth-Consent und den DSGVO-Hinweis (§6.5). Ab dem zweiten Start: App-Icon antippen → Daten sind sofort da.

---

## 5. Funktionen — Ist-Zustand (v1 / Phase 1)

### 5.1 Dashboard
- Gesamtstatistik: Anzahl Patienten, Sitzungen, Behandlungsstunden, Supervisionsstunden
- Warnungen bei Supervisionsdefizit
- Patientenliste mit Status-Badges, Klick → Detailansicht

### 5.2 Patientenverwaltung
- CRUD (Name, Kürzel, Kontingent, Therapiebeginn)
- Detailansicht mit Stundenzählern, Kontingent-Balken, Supervisionsverhältnis

### 5.3 Sitzungsverwaltung
- Neue Sitzung anlegen (Datum, Art, Dauer, Patient)
- Anlegen aus Patientendetail, Löschen

### 5.4 Supervisionsverwaltung
- Übersicht mit Gesamtfortschritt und Pro-Patient-Verhältnis
- Anlegen mit Gruppenauswahl (Auto-Zuordnung) oder manueller Checkbox-Auswahl
- Automatische Gruppenerkennung beim Anlegen aus Patientendetail

### 5.5 Supervisionsgruppen
- CRUD, Patientenzuordnung, Standard-Supervisor pro Gruppe

### 5.6 Datenmanagement
- **Auto-Load** beim App-Start aus IndexedDB (kein manueller Schritt)
- **Auto-Save** nach jeder Mutation in IndexedDB (debounced 300ms)
- **Auto-Backup** zu Google Drive bei `visibilitychange=hidden`
- **Manuelles "Jetzt sichern"** in den Einstellungen
- **Manueller JSON-Export** als Escape-Hatch
- **Manueller JSON-Import** mit Bestätigung und voller Validierung (§6.2)
- **Einstellungen**: Supervisionsverhältnis, Standard-Kontingent
- **Daten löschen**: Lokal (IndexedDB) und/oder Drive-Backup, mit doppelter Bestätigung

### 5.7 Self-Service-Diagnose
Versteckter Debug-Panel (erreichbar via 5-fach-Tap auf den App-Header oder URL-Query `?debug=1`), zeigt an:

- IndexedDB-Größe (approximiert über `JSON.stringify(appData).length`)
- Letzter erfolgreicher Drive-Sync-Zeitstempel
- Letzter Sync-Fehler (Message + HTTP-Status)
- Letzter Render-Fehler pro Tab
- Aktuelle Schema-Version und SW-Cache-Version
- Button "Diagnose-JSON kopieren" für Support-Zwecke

Keine Telemetrie, kein Upload — nur lokale Anzeige.

---

## 6. Sicherheitsaspekte

### 6.1 XSS-Schutz
Alle nutzergenerierten Strings (Patientennamen, Notizen, Supervisornamen) müssen vor der Einfügung in `innerHTML` durch `escapeHtml()` (aus `validation.js`) geleitet werden.

**Pflicht für alle Features, ohne Ausnahme.** Wird in der §15-Regelliste erfasst.

**Verpflichtender Test**: `tests/grenzwerte.spec.ts` enthält mindestens eine XSS-Testbatterie, die folgende Payloads als Patientennamen, Notizen und Supervisor-Namen eingibt und prüft, dass sie als Text gerendert werden, kein JavaScript ausführen:

- `<img src=x onerror=alert(1)>`
- `<script>alert(1)</script>`
- `"><svg onload=alert(1)>`
- `javascript:alert(1)` in beliebigen Input-Feldern

### 6.2 Import-Validierung
`validation.js` exportiert `validateAppData(obj)`, das folgende Regeln anwendet:

- Top-Level ist ein Objekt mit numerischem (oder fehlendem) `version`
- `patients`: Array von Objekten mit `id: string` (Base-36-Pattern), `name: string` (≤500 chars), `kontingent: number > 0`
- `sessions`: Array mit `id`, `patientId: string`, `date: string` (ISO-Pattern), `type: einzel|doppel|gruppe|probatorik`, `duration: number > 0`
- `supervisions`: Array mit `id`, `patientIds: string[]`, `date`, `type: einzel|gruppe`, `duration`
- `supervisionGroups`: Array mit `id`, `name`, `patientIds: string[]`
- Unbekannte Top-Level-Properties werden verworfen
- Bei **jedem** Fehlschlag: vollständige Ablehnung, der aktuelle Zustand wird nicht angerührt, Fehlermeldung nennt den ersten Fehler mit Pfad (z.B. `sessions[3].type: invalid enum value`)

`validateAppData()` wird in **drei** Pfaden aufgerufen: JSON-Import, Drive-Restore, IndexedDB-Load. Identisch.

### 6.3 Content Security Policy
`index.html` enthält im `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://accounts.google.com https://apis.google.com;
  connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com;
  img-src 'self' data: https://*.googleusercontent.com;
  style-src 'self' 'unsafe-inline';
  font-src 'self';
  frame-src https://accounts.google.com;
  base-uri 'self';
  form-action 'none';
  object-src 'none';
">
```

`'unsafe-inline'` im `style-src` ist erlaubt (inline CSS in Modals); `'unsafe-inline'` im `script-src` ist **verboten** — das erzwingt, dass alle Inline-Event-Handler (`onclick="..."`) durch den Base-36-ID-Contract sicher bleiben und kein neues Feature CSP-Lücken aufreißt.

### 6.4 Subresource Integrity (SRI) — Tradeoff
GIS (`https://accounts.google.com/gsi/client`) rotiert seine URL und kann nicht sinnvoll per SRI-Hash gepinnt werden. **Kompensierende Kontrollen**:

1. Minimaler OAuth-Scope (`drive.appdata`) — selbst wenn GIS kompromittiert würde, ist der Schaden auf diesen einen Scope begrenzt
2. Same-Origin-DOM-Isolation (GIS läuft im iframe von `accounts.google.com`)
3. CSP beschränkt `script-src` auf genau diese Google-Origins
4. Keine User-Credentials werden an GIS übergeben — das Popup läuft vollständig Google-seitig

Dieser Tradeoff wird akzeptiert als Preis für die Zero-Build-Architektur.

### 6.5 DSGVO-Erstlauf-Hinweis
Beim **allerersten** App-Start (vor jeder Dateninteraktion) zeigt die App einen **nicht-dismissbaren Modal** mit folgendem Inhalt:

- **Was wird gespeichert**: Namen, Kürzel, Sitzungsdaten, Supervisionsdaten von Patient:innen
- **Wo wird es gespeichert**: lokal auf dem Gerät (IndexedDB) und im persönlichen Google-Drive (unsichtbarer App-Bereich, `drive.appdata`-Scope)
- **Wer hat Zugriff**: nur der Nutzer. Die App überträgt keine Daten an Dritte außer an Google Drive
- **Rechtsgrundlage**: Dokumentationspflicht der PP-Ausbildung gemäß PsychThG, berechtigtes Interesse
- **Buttons**: "Verstanden und einverstanden" (freischaltend) oder "App verlassen"

Die Zustimmung wird als `appData.settings.dsgvoAcknowledgedAt: ISO-datetime` persistiert. Bei fehlendem Feld erscheint der Modal erneut.

### 6.6 At-Rest-Encryption — Phase-1-Position
**Phase 1 verschlüsselt IndexedDB-Daten nicht.** Rationale:

- IndexedDB-Daten sind an das installierte Browser-Profil gebunden und durch die Geräte-Sicherheit (PIN/Biometrie) geschützt
- Google Drive verschlüsselt gespeicherte Daten standardmäßig (in transit + at rest) per Google-eigene Keys
- Eine browserseitige Zusatz-Verschlüsselung mit Nutzer-Passphrase würde die Nullreibung-Versprechung brechen (Passphrase bei jedem Start)
- Für das Bedrohungsmodell "Gerät wird unbeobachtet genutzt durch Dritte" ist die Geräte-PIN die primäre Verteidigung

**Phase 5+ (Roadmap §12)**: optionale WebCrypto-AES-GCM-Wrapping mit nutzerwählbarer Passphrase als Opt-In. Schlüsselableitung via PBKDF2 mit 600.000 Iterationen. Der Nutzer kann dann zwischen Nullreibung und Zusatzschutz wählen.

### 6.7 OAuth-Scope-Minimalität
Die App verlangt **ausschließlich** `drive.appdata`. Kein Zugriff auf andere Drive-Dateien, keine User-Info, kein Profile-Scope. Dies ist im Consent-Dialog für den Nutzer sichtbar.

### 6.8 Inline-Event-Handler
`onclick="fn('${id}')"` ist zulässig, weil `generateId()` ausschließlich Base-36-alphanumerische IDs liefert. Bei Änderung der ID-Generierung muss dieses Pattern neu bewertet werden.

### 6.9 Keine Telemetrie
Keine Analytics, kein Error-Reporting an Dritte, keine Drittanbieter-Fonts, keine CDN-Tracker. Nur die in §6.3 CSP-Policy aufgelisteten Google-Origins werden überhaupt kontaktiert.

---

## 7. Fehlerbehandlung & Resilienz

### 7.1 IndexedDB-Fehler

| Fehler | Verhalten |
|---|---|
| `QuotaExceededError` | Modal: "Lokaler Speicher voll. Bitte JSON-Export erstellen und alte Daten archivieren." Mutation rollt zurück (in-memory `appData` wird aus dem letzten erfolgreich gespeicherten IDB-Stand neu geladen). Drive-Backup wird versucht, damit zumindest die Cloud-Version aktuell bleibt. |
| `InvalidStateError` / DB-Corruption | Modal: "Lokale Datenbank beschädigt. Option 1: aus Drive-Backup wiederherstellen. Option 2: JSON-Export importieren. Option 3: App zurücksetzen." Bietet alle drei Buttons an. |
| Transaction abgebrochen | Stiller Retry (einmal). Bei wiederholtem Fehler: Toast "Speichern fehlgeschlagen" + automatischer Re-Schedule nach 5s. |
| DB blockiert (andere Tab-Instanz) | Toast "App ist in einem anderen Tab offen" — verhindert Doppel-Schreibvorgänge. |

### 7.2 Drive-Sync-Fehler (Retry/Backoff-Kontrakt)

**Phase 1 Policy** (minimal aber definiert):

| HTTP-Status / Fehler | Verhalten |
|---|---|
| `401 Unauthorized` | Stiller Re-Auth-Versuch via GIS `prompt: ''`. Bei Fehlschlag: Status-Indikator "Neu anmelden" im Settings-Tab. |
| `403 Forbidden` (Quota/Rate) | Einmaliger Retry nach 30 Sekunden. Bei zweitem Fehler: Toast "Drive-Backup pausiert — nächster Versuch beim nächsten Start". |
| `5xx` (Server) | Einmaliger Retry nach 30 Sekunden. Bei zweitem Fehler: siehe 403. |
| Network-Fehler (offline) | Sofortiger Abbruch, kein Retry. Sync wird beim nächsten `visibilitychange=hidden` mit wieder verbundener Connection automatisch versucht. |
| JSON-Parse-Fehler beim Download | Restore abgelehnt, lokaler Zustand bleibt unangetastet, Fehler-Toast mit "Drive-Backup korrupt — bitte JSON-Export nutzen". |

**Keine Offline-Queue in Phase 1**. Der `dirty`-Flag im `state.js` persistiert in IDB. Beim nächsten Sync-Trigger wird `dirty` geprüft, bei `true` wird ein Sync versucht — das ist der "implizite Queue-Mechanismus".

### 7.3 Restore-Atomicity-Kontrakt

Beim Drive-Restore (oder JSON-Import):

1. **Download** der Drive-Datei in lokale Variable `pendingData`
2. **Validate** via `validateAppData(pendingData)` — bei Fehlschlag: Abbruch, aktueller `appData` bleibt unverändert
3. **Migrate** via `migrations.js` — bei Fehlschlag: Abbruch, aktueller `appData` bleibt unverändert, Fehlermeldung mit Schritt-Nummer der fehlgeschlagenen Migration
4. **Snapshot** des aktuellen `appData` als Rollback-Punkt (nur in-memory für diese Transaktion)
5. **Commit**: atomic swap von `appData` in `state.js`, dann `db.saveAppData()`, dann `renderAll()`
6. Bei Fehler während Commit: Rollback zum Snapshot, Fehler-Toast

**Garantie**: Ein teilweise geladener oder korrupter Payload kann den laufenden In-Memory-State niemals ersetzen.

### 7.4 Render-Fehler-Isolation

Siehe §4.9. Jeder Tab-Renderer ist in eigenem try/catch gekapselt. Bei Fehler: Fallback-Shell im betroffenen Tab, andere Tabs unberührt, Fehler im Self-Diagnose-Panel (§5.7) protokolliert.

### 7.5 Service-Worker-Update-Verhalten

- Neue SW-Version verfügbar → Toast "Neue Version verfügbar — neu laden?" mit zwei Buttons: "Jetzt neu laden" / "Später"
- "Später"-Click: Toast schließt, Badge im Settings-Tab bleibt
- **Stale-Client-Upper-Bound**: Wenn die aktuell laufende SW-Instanz älter als 14 Tage ist (`Date.now() - activatedAt > 14 * 86400 * 1000`), überspringt der nächste App-Start den Toast und reloaded hart. Rationale: kein Nutzer soll unabsichtlich monatelang auf einer alten Version festsitzen.
- Bei `version > CURRENT_VERSION` im geladenen appData: Modal "Diese Daten wurden von einer neueren App-Version erstellt. Bitte App aktualisieren (Browser-Refresh). Falls das Problem bleibt: JSON-Export nutzen und mit Admin kontaktieren." → kein automatisches Re-Open bis zum Nutzer-Handeln.

### 7.6 Auth-Verlust / Kontosperrung

Siehe §4.5. Rein lokale Weiterverwendung ist immer garantiert, Drive-Sync wird deaktiviert, Nutzer wird über Settings-Tab informiert.

---

## 8. Teststrategie

### 8.1 Framework-Layer

Zweischichtig:

1. **Unit-Tests** (`tests/unit/*.test.js`) — laufen in Node 20+ ohne Browser, testen reine Funktionen. Framework: **Node Test Runner** (`node --test`) — zero dependency, in Node 20+ eingebaut.
   - `migrations.test.js`: v0→v1-Migration, jede künftige Migration, Rundtrip-Tests
   - `validation.test.js`: `escapeHtml`-XSS-Payloads, `validateAppData`-Edge-Cases, Format-Konstanten
   - `calculations.test.js`: Stundenberechnung (`duration / 50`), Supervisionsverhältnis, Kontingent-Progress

2. **End-to-End-Tests** (`tests/*.spec.ts`) — Playwright 1.58.2+
   - `dashboard.spec.ts` — Dashboard, Navigation, FAB
   - `patienten.spec.ts` — Patienten-CRUD, Sitzungen, Supervision
   - `loeschen.spec.ts` — Lösch-Kaskaden, Bestätigungen
   - `daten.spec.ts` — Export, Import, IndexedDB-Persistenz, **Drive-Backup (gemockt)**
   - `grenzwerte.spec.ts` — Validierung, **XSS-Payload-Batterie** (§6.1), Schema-Grenzwerte
   - `skalierung.spec.ts` — Performance-Budgets (siehe §8.4)
   - `pwa.spec.ts` — Service Worker, Offline-Modus, Manifest, Auto-Load beim Start, Stale-Client-Verhalten
   - `migration.spec.ts` — End-to-End-Laden eines Legacy-Single-File-HTML-JSON-Exports → Schema v1

### 8.2 Geräteabdeckung (E2E)

| Projekt | Gerät | Status |
|---|---|---|
| chromium | Desktop Chrome | Standard |
| firefox | Desktop Firefox | Cross-Browser |
| webkit | Desktop Safari | WebKit-Engine |
| **pixel8a** | **Pixel 8a (Android)** | **PFLICHT — primäres Zielgerät, jeder Test** |
| ipad-gen7 | iPad (gen 7) | Tablet |
| iphone15 | iPhone 15 | iOS Safari |

`pixel8a` ersetzt das bisherige `pixel7`-Profil in `playwright.config.ts`.

### 8.3 Drive-Mocking

Drive-API-Calls werden **ausschließlich** gegen einen Mock getestet. `tests/helpers.ts` exportiert `mockDriveClient(page)`, das Playwright-Request-Interception nutzt, um `www.googleapis.com/drive/v3/*` auf konfigurierbare Fake-Responses zu routen. Tests dürfen **niemals** echte Google-Accounts verwenden. Verstöße dagegen werden in der CI durch einen Guard-Grep abgelehnt.

### 8.4 Performance-Budgets (E2E + `skalierung.spec.ts`)

Gemessen auf dem `pixel8a`-Profil:

| Metrik | Budget | Messmethode |
|---|---|---|
| Time-to-Interactive (TTI) cold start | <2000 ms | `pwa.spec.ts` nach Service-Worker-Install |
| Time-to-Interactive warm start (second launch) | <500 ms | Daten schon in IDB |
| Interaction-to-Next-Paint (INP) nach Mutation | <200 ms | CRUD-Flow, gemessen nach jedem `updateAppData`-Call |
| `renderAll()` bei Baseline-Scale (30 Patienten × 30 Sessions = 900 rows) | <150 ms | Script-Timer um `renderAll()` |
| `renderAll()` bei 2× Scale (60 × 40 = 2400 rows) | <400 ms | Eskalations-Schwellenwert |
| JSON-Export (Baseline-Scale) | <500 ms | |
| Service-Worker-Install | <1000 ms | |

**Eskalations-Regel**: Wenn bei 2× Scale `renderAll()` das 400ms-Budget überschreitet, ist das der dokumentierte Schwellenwert für die Einführung von inkrementellem View-Level-Rendering (siehe §9.3).

### 8.5 PWA-Offline-Verifikation

`pwa.spec.ts` folgt diesem Pattern:

```typescript
await page.goto('/');
await page.waitForServiceWorker();
await page.context().setOffline(true);
await page.reload();
await expect(page.locator('#dashboard')).toBeVisible(); // muss aus Cache laden
// ...CRUD offline durchspielen...
await page.context().setOffline(false);
```

Zusätzlich wird die Manifest-Erreichbarkeit (`/manifest.webmanifest`) und das `installprompt`-Event geprüft.

### 8.6 Migrations-Test-Regel

**Regel**: Jeder Version-Bump in `migrations.js` muss mit einer entsprechenden Test-Fixture geliefert werden:

- `tests/fixtures/appData-v{n-1}.json`: repräsentativer Zustand vor der Migration
- `tests/fixtures/appData-v{n}-expected.json`: erwarteter Zustand nach der Migration
- `migrations.test.js` lädt die v(n-1)-Fixture, wendet `MIGRATIONS`-Array an und asserted Gleichheit mit v(n)-Expected

### 8.7 Legacy-Migrations-Test

`migration.spec.ts` enthält einen End-to-End-Test, der einen echten JSON-Export der Legacy-Single-File-HTML (als `tests/fixtures/legacy-single-file-export.json` eingecheckt) über die Import-UI lädt und prüft, dass das Ergebnis dem kanonischen v1-Beispiel aus §3 entspricht.

### 8.8 CI & OS-Matrix

GitHub Actions (`.github/workflows/test.yml`):

- **Ubuntu 24.04** (primärer Runner): alle Unit-Tests + E2E auf `chromium`, `firefox`, `webkit`, `pixel8a`, `ipad-gen7`, `iphone15`
- **macOS 14**: zusätzlich WebKit-Tests (Safari-Engine auf nativem macOS)
- Node 20 LTS
- Trigger: auf Push zu `main` und auf jeden Pull Request

Die CI ist grünes Gate für jeden Merge nach `main`.

### 8.9 Testregel für Feature-Pläne

- Jedes neue Feature: mindestens **ein E2E-Test** auf dem `pixel8a`-Profil
- Pure Logik (Berechnungen, Validatoren, Migrations) wird **zusätzlich** als Unit-Test abgedeckt
- `test-mapping.json` wird aktualisiert
- XSS-Schutz neuer Input-Felder durch die §6.1-Batterie abgedeckt (wenn nötig erweitert)

---

## 9. Performance & Skalierung

### 9.1 Scale-Envelope

| Dimension | Baseline (typisch) | Upper Bound (geplant) | 2× Stress (Budget-Grenze) |
|---|---|---|---|
| Patienten | 15 | 30 | 60 |
| Sessions total | 300 | 800 | 2.400 |
| Supervisionen total | 100 | 250 | 600 |
| Supervisionsgruppen | 3 | 6 | 12 |
| `JSON.stringify(appData).length` | ~30 KB | ~100 KB | ~300 KB |

### 9.2 In-Memory-Budget

`appData` wird als einzelnes JavaScript-Objekt im Heap gehalten. Obergrenze im Plan: **300 KB serialisiert**, was als Objekt-Graph ~1–2 MB Heap entspricht. Für einen Pixel 8a mit 8 GB RAM ist das vernachlässigbar.

### 9.3 `renderAll()`-Analyse

**Baseline (900 rows)**: Unter 150 ms auf Pixel 8a — Budget laut §8.4. Das entspricht einem linearen Render ohne virtualisierte Listen, was für diese Scale komfortabel im Rahmen liegt.

**2× Stress (2400 rows)**: Budget 400 ms. Wenn dieses Budget überschritten wird, ist der **dokumentierte Schwellenwert für inkrementelles Rendering** erreicht. Migrationspfad (nicht Teil Phase 1):

1. `renderAll()` wird aufgeteilt in `renderDashboard()`, `renderPatientList()`, `renderSupervisionOverview()`, `renderActivePatientDetail()`
2. `updateAppData(patchFn)` akzeptiert optional einen `changedSlice`-Hint (`'patients' | 'sessions' | 'supervisions' | 'groups'`) und ruft nur die betroffenen Render-Funktionen
3. `patch`-basiertes Diffing der DOM-Knoten bleibt als letzter Schritt, ist aber in Phase 1 nicht nötig

### 9.4 Start-Performance

- **Cold Start (erster Besuch)**: Network-gebunden (Download der App-Shell). Ziel: TTI <2000 ms auf 4G
- **Warm Start (installiert, aus Homescreen)**: Service-Worker-Cache liefert alles instant, IDB-Load ist <50 ms bei Baseline-Scale, `renderAll()` <150 ms. Ziel: TTI <500 ms
- **Post-Install-Re-Auth**: GIS stilles Re-Auth blockiert NICHT das erste Rendering — die App zeigt sofort die lokalen Daten, Drive-Sync ist async im Hintergrund

### 9.5 Mutations-Performance (INP)

Ziel: **INP <200 ms** nach jedem CRUD. Der Pfad:

1. Event-Handler ruft `updateAppData(patchFn)` (~1 ms)
2. `patchFn` mutiert `appData` (~1 ms)
3. `renderAll()` re-rendert (<150 ms bei Baseline, <400 ms bei 2× Stress)
4. Debounced IDB-Write (300 ms später, async, blockiert INP nicht)

### 9.6 Drive-Sync-Performance

Nicht im interaktiven Pfad. Sync läuft bei `visibilitychange=hidden`, also nachdem der Nutzer die App in den Hintergrund verschiebt. Budget: freiwillig, kein hartes Limit.

---

## 10. Rollout, Migration & Rückwärtskompatibilität

### 10.1 Release-Mechanismus

- Push nach `main` → GitHub Actions läuft CI → bei Erfolg automatischer Deploy auf GitHub Pages
- Service Worker `CACHE_VERSION` in `sw.js` muss **manuell** inkrementiert werden bei jedem Release, sonst erkennen Clients das Update nicht
- Git-Tag `v1.0.0`, `v1.1.0`, etc. folgt SemVer, wo MAJOR = Schema-Version-Bump

### 10.2 Legacy-Single-File-HTML-Migration

Der bestehende Single-File-HTML-Nutzer migriert so:

1. In der Legacy-App: "JSON-Export" → lokale Datei speichern
2. Neue PWA im Pixel 8a Chrome öffnen, OAuth-Consent + DSGVO-Hinweis durchlaufen
3. In der PWA: Tab "Daten" → "Importieren" → Datei auswählen
4. Import durchläuft `validateAppData()` → migriert von implizit Version 0 auf Version 1 über den v0→v1-Migrationspfad
5. Automatisches Auto-Backup zu Drive bei erstem `visibilitychange=hidden`

**Test-Garantie**: `migration.spec.ts` (§8.7) verifiziert diesen Flow End-to-End mit einer realen Legacy-Export-Fixture.

### 10.3 Migrations-Rollback

`migrations.js` wrapped jede Migration in try/catch:

```javascript
function runMigrations(data) {
  const snapshot = structuredClone(data);  // Rollback-Punkt
  try {
    for (const mig of MIGRATIONS) {
      if (data.version < mig.to) {
        data = mig.up(data);
        data.version = mig.to;
      }
    }
    return data;
  } catch (err) {
    showToast(`Migration ${mig.from}→${mig.to} fehlgeschlagen: ${err.message}. JSON-Export jetzt erstellen.`, 'danger');
    return snapshot;  // Rollback
  }
}
```

**Garantie**: Eine fehlgeschlagene Migration kann niemals einen partiellen Zustand hinterlassen. Der Pre-Migrations-Snapshot wird zurückgegeben und die App läuft auf der alten Version weiter, bis der Nutzer manuell eingreift.

### 10.4 Stale-Client-Grenze

Siehe §7.5. Clients, die länger als 14 Tage nicht neu geladen haben, werden beim nächsten Start zwangsweise auf die aktuelle Version gehoben, ohne auf den User-Click zum "Jetzt neu laden"-Toast zu warten.

### 10.5 Version-Konflikt `version > CURRENT_VERSION`

Wenn beim Laden (aus IDB, Drive oder Import) ein `version`-Wert größer als die aktuelle Code-Version entdeckt wird:

1. Laden wird **abgebrochen** — kein Zugriff auf die Daten, kein Überschreiben
2. Modal: "Die geladenen Daten wurden von einer neueren App-Version erstellt. Bitte aktualisieren Sie die App (Tab schließen und neu öffnen). Falls das nicht hilft: JSON-Export über die Legacy-Version erstellen und bei Admin melden."
3. Optionen im Modal: "App neu laden" (erzwingt SW-Update) oder "App verlassen"
4. **Keine automatische Degradation** — das würde Daten stumm verlieren

### 10.6 Append-Only-Migrationen

**Regel**: Einmal released, darf eine Migration niemals nachträglich editiert, umsortiert, oder gelöscht werden. Begründung: bereits migrierte Clients haben den Schritt übersprungen und würden ihn nicht erneut ausführen. Eine nachträgliche Änderung würde einen Teil der Installationen in einem inkonsistenten Zustand zurücklassen.

Diese Regel ist in §15 als harte Regel aufgeführt.

### 10.7 Rollback zum vorherigen Release

Falls ein Release fehlerhaft ist und der Hotfix länger dauert:

1. Git-Revert des Release-Commits auf `main`
2. `CACHE_VERSION` in `sw.js` weiter hochzählen (niemals rückwärts)
3. Stale-Clients erhalten beim nächsten Update die (zurückgesetzte) alte Version
4. Wenn ein Schema-Bump im fehlerhaften Release war: **Revert ist nicht mehr möglich**, weil Clients die neuere Schema-Version bereits geschrieben haben. Einzige Option: Hotfix vorwärts, nie rückwärts bei Schema-Bumps. Deshalb: Schema-Bumps sind **besonders vorsichtig** zu releasen und idealerweise separat von anderen Änderungen.

---

## 11. MVP (Phase 1) — Definition of Done & Freeze-Liste

### 11.1 Definition of Done

Phase 1 ist abgeschlossen, wenn **alle** folgenden Kriterien erfüllt sind:

1. Alle E2E-Tests grün auf dem `pixel8a`-Profil (Pflicht), plus grün auf den anderen 5 Profilen
2. Alle Unit-Tests grün (`migrations`, `validation`, `calculations`)
3. PWA installierbar auf Pixel 8a via "Zum Home-Bildschirm hinzufügen"
4. Auto-Load aus IndexedDB funktioniert ab dem zweiten Start ohne jede Nutzer-Interaktion
5. Auto-Backup zu Drive bei `visibilitychange=hidden` funktioniert und ist in `daten.spec.ts` verifiziert (gemockt)
6. DSGVO-Erstlauf-Hinweis erscheint und persistiert die Zustimmung
7. JSON-Export und -Import funktionieren als Escape-Hatch
8. `migration.spec.ts` Legacy→v1 ist grün
9. Service Worker cached die App-Shell, Offline-Betrieb ist in `pwa.spec.ts` verifiziert
10. CSP Meta-Tag ist aktiv und verletzt keine laufenden Features
11. Performance-Budgets aus §8.4 werden auf Pixel 8a eingehalten
12. Self-Service-Diagnose-Panel (§5.7) ist implementiert
13. Setup-Anleitung (§17) ist verifiziert (Durchlauf auf frischem Google-Account + frischem Gerät)

### 11.2 Phase-1-Freeze-Liste (bewusst _nicht_ im MVP)

Feature-Planner und Reviewer können diese Liste zitieren, um Scope-Creep abzulehnen:

- ❌ Per-Mutation Drive-Sync (Phase 2)
- ❌ Multi-Device-Konfliktauflösung (Phase 3)
- ❌ PDF-Berichte (Phase 4)
- ❌ Dashboard-Charts (Phase 4)
- ❌ `patient.status` aktiv/inaktiv — erfordert Schema v2 (Phase 4)
- ❌ Sitzungshäufigkeits-Statistik (Phase 4)
- ❌ Dark Mode (Phase 4)
- ❌ Suchfunktion (Phase 4)
- ❌ Optionale Felder (Diagnose, Verfahren, Notizen) (Phase 4)
- ❌ Antragsverwaltung (Phase 4)
- ❌ At-Rest-Encryption mit Passphrase (Phase 5+)
- ❌ Gesamt-Ausbildungsfortschritt-Tab (Phase 4, fachliche Klärung nötig)
- ❌ Probatorik-Ausschluss aus Kontingent (fachliche Klärung offen)
- ❌ Multi-Gruppen-Patienten-Auswahl-Dialog (fachliche Klärung offen)

---

## 12. Roadmap

### Phase 1 (MVP, aktueller Scope)
Siehe §4, §5, §11. Single-Device, Auto-Load aus IDB, Auto-Backup zu Drive auf visibilitychange.

### Phase 2 — Sofortige Drive-Synchronisation
- Jede Mutation wird debounced (~2s) direkt nach Drive gepusht
- Offline-Queue mit Exponential Backoff
- Erfordert Ausbau von §7.2 Drive-Retry-Policy
- **Keine Architekturänderung** — nur zusätzliche Trigger im `markDriveDirty()`-Pfad

### Phase 3 — Multi-Device
- Aufgabe des §1-Kontrakts "ein Gerät, ein Nutzer"
- `modifiedTime`-Vergleich beim App-Start
- Last-Write-Wins mit Warndialog "Änderungen von anderem Gerät gefunden, übernehmen?"
- Lokaler Snapshot als Rollback-Option
- Später: per-Entity-Merging

### Phase 4 — Feature-Erweiterungen
Priorität hoch: Gesamtfortschritt Ausbildung-Tab
Priorität mittel: PDF-Berichte (`window.print()` + Print-Stylesheet), Dashboard-Charts, Patient-Status aktiv/inaktiv, Sitzungshäufigkeit
Priorität niedrig: Optionale Felder, Antragsverwaltung, Suchfunktion, Dark Mode

### Phase 5+ — Hardening
- WebCrypto AES-GCM At-Rest-Encryption mit Passphrase (Opt-In)
- Accessibility-Pass (Keyboard-Navigation für `<div onclick>`-Elemente, ARIA-Labels)
- Fachliche Klärungen: Probatorik-Status, Multi-Gruppen-Patienten

---

## 13. Designprinzipien

### Mobile-First, Pixel-8a-First
Primäre Nutzung: Pixel 8a als installierte PWA. Alle UI-Elemente touch-optimiert, Bottom-Sheet-Modals.

### Nullreibung ab dem zweiten Start
Der Nutzer tippt auf das Homescreen-Icon und sieht sofort seine Daten. Kein Login, kein Dateidialog. **Der erste Start ist die einzige Ausnahme**: DSGVO-Hinweis + Google-OAuth-Consent (zusammen ≤30 Sekunden).

### Zero-Build, Zero-Runtime-Dependency (außer GIS)
Kein Bundler, keine NPM-Runtime-Dependencies. Der Code läuft direkt im Browser, wie er im Repo liegt. Einzige Ausnahme: GIS vom Google-CDN.

### Offline-First
Service Worker cached die gesamte App-Shell. Die App funktioniert komplett ohne Netzwerk. Nur Drive-Sync pausiert und wird nachgeholt.

### Einfachheit vor Vollständigkeit
Features werden nur eingebaut, wenn sie aktiv gebraucht werden. Siehe §3 "bewusst weggelassen", §11.2 Freeze-Liste.

### Datenhoheit
Keine Telemetrie, keine Analytics, keine Drittanbieter-Requests außer Google Drive. Der Nutzer besitzt seine Daten in seinem eigenen Drive.

---

## 14. Konventionen & Nicht-Verhandelbare Regeln

Referenz-Liste aller harten Regeln. Feature-Pläne müssen jede einzelne respektieren:

1. **IndexedDB ist der lokale Wahrheitszustand.** Kein `localStorage`, kein `sessionStorage`.
2. **`state.js` besitzt `appData`.** Mutationen nur via `updateAppData(patchFn)`.
3. **Drive `appDataFolder` ist der einzige Cloud-Endpunkt.** Kein eigener Server, keine anderen Drive-Scopes.
4. **`escapeHtml()` auf jeder Nutzereingabe** vor `innerHTML`-Insertion. Keine Ausnahmen.
5. **`validateAppData()` läuft auf allen Load-Pfaden** (IDB-Load, Drive-Restore, JSON-Import).
6. **Kein `alert()` / `confirm()`** — immer Custom-Dialoge + Toast.
7. **Keine neuen Runtime-Dependencies** außer GIS vom Google-CDN.
8. **Kein Build-Step.** Code läuft wie er im Repo liegt. ES-Module direkt im Browser.
9. **Schema-Änderungen erfordern Version-Bump + Migration + Test-Fixture.**
10. **Migrationen sind append-only.** Einmal released, nie editieren oder umsortieren.
11. **Neue Features brauchen E2E-Tests** auf dem `pixel8a`-Profil. Pure Logik zusätzlich Unit-Tests.
12. **Stundenberechnung**: immer `duration / 50`.
13. **ID-Generierung**: Base-36-alphanumerisch, keine anderen Zeichen.
14. **Datumsformat**: ISO `YYYY-MM-DD`, keine Zeitzonen.
15. **CSP darf nicht aufgeweicht werden.** Insbesondere kein `'unsafe-inline'` in `script-src`.
16. **Keine Telemetrie, keine Analytics, keine Drittanbieter-Requests.**
17. **Keine echten Google-Accounts in Tests** — Drive immer gemockt.
18. **Pixel 8a ist Pflicht-Testprofil** für jeden neuen E2E-Test.

---

## 15. Feature-Plan-Vertrag

Diese Sektion definiert, wie Feature-Pläne zu schreiben sind, damit parallele Entwicklung kollisionsfrei bleibt.

### 15.1 Shape eines Feature-Plans

Jeder Feature-Plan muss enthalten:

1. **Referenzen auf betroffene Regeln** aus §14 (welche bleiben, welche werden ggf. erweitert — nie aufgeweicht)
2. **Liste der betroffenen Module** (`state.js`, `db.js`, `drive.js`, `migrations.js`, `validation.js`, `render.js`, `app.js`, `styles.css`)
3. **Datenmodell-Delta**: neue Felder, neue Enum-Werte, neue Entitäten — mit Schema-Version-Bump falls nötig
4. **Mutations-Patches**: welche neuen `patchFn`-Signaturen werden `updateAppData()` übergeben
5. **Render-Hooks**: welche bestehenden Render-Funktionen werden ergänzt, welche kommen neu dazu
6. **Test-Plan**: direkte E2E-Tests + Unit-Tests + Update an `test-mapping.json`
7. **Rollback-Strategie**: falls das Feature entfernt werden muss — gibt es Migrationen, die nicht rückwärts laufen?

### 15.2 Mutations-Kontrakt

Alle Schreibzugriffe gehen durch:

```javascript
// state.js
export function updateAppData(patchFn) {
  try {
    patchFn(appData);                // 1. mutate in-place
    render.renderAll();              // 2. re-render UI
    db.scheduleWrite(appData);       // 3. debounced 300ms IDB persist
    markDriveDirty();                // 4. flag for next Drive flush
  } catch (err) {
    showToast(err.message, 'danger');
    scheduleReloadFromIdb();         // safety net
  }
}
```

**Regel**: Keine Feature-Code darf `appData` direkt mutieren, ohne durch `updateAppData` zu gehen. Lese-Zugriff via `getAppData()` (liefert `structuredClone`).

### 15.3 Rendering-Hooks

Neue Tabs oder Subsections folgen dem Muster:

```javascript
// render.js
export function renderAll() {
  safeRender('dashboard', renderDashboard);
  safeRender('patients', renderPatientList);
  safeRender('supervision', renderSupervisionOverview);
  safeRender('groups', renderGroupsList);
  safeRender('data', renderDataTab);
  // neu: safeRender('ausbildung', renderAusbildungTab);
}

function safeRender(tabId, fn) {
  try { fn(); }
  catch (err) { /* fallback shell + log to diagnostics */ }
}
```

Ein neues Feature ergänzt genau eine Zeile in `renderAll()` und exportiert seine eigene Render-Funktion.

### 15.4 Split-Konvention für `app.js`

Falls `app.js` einzelne Schwelle überschreitet (Richtlinie: **>1000 Zeilen**), wird per Tab aufgeteilt:

```
js/
├── tabs/
│   ├── dashboard.js
│   ├── patients.js
│   ├── supervision.js
│   ├── groups.js
│   └── data.js
├── state.js
├── db.js
├── drive.js
...
```

Jedes `tabs/*.js` exportiert seine Render-Funktion, seine Event-Handler und seine Modal-Definitionen. `app.js` wird zum reinen Wiring-Modul (Init, Tab-Switcher, globale Events).

Dieser Split ist **kein Phase-1-Ziel**, sondern ein dokumentierter Escape-Valve.

---

## 16. Setup-Anleitung (einmalig, entwicklerseitig)

### Schritt 1: Google Cloud Projekt
1. https://console.cloud.google.com → neues Projekt "NemPSTi"
2. **APIs & Services → Library**: "Google Drive API" aktivieren

### Schritt 2: OAuth-Zustimmungsbildschirm
1. **APIs & Services → OAuth consent screen**
2. User Type: "External"
3. App-Name: "Patientenstunden-Tracker"
4. Scopes: `https://www.googleapis.com/auth/drive.appdata`
5. Test-Nutzer: eigene Google-Adresse
6. Publishing Status: "In Testing" reicht für Einzelnutzung

### Schritt 3: OAuth Client ID
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Type: "Web application"
3. Name: "NemPSTi Web Client"
4. **Authorized JavaScript origins**: `https://<github-user>.github.io`
5. Client-ID kopieren → in `drive.js` als `GOOGLE_CLIENT_ID`-Konstante

### Schritt 4: GitHub Pages
1. Repo auf GitHub erstellen, Code pushen
2. **Settings → Pages**: Source = `main` Branch, Root
3. **Settings → Pages → Custom Domain** optional
4. Nach Deploy: App unter `https://<user>.github.io/<repo>/`

### Schritt 5: GitHub Actions CI
1. `.github/workflows/test.yml` committen (Ubuntu + macOS Matrix, Node 20)
2. Erster PR verifiziert CI

### Schritt 6: Verifikation auf Pixel 8a
1. Chrome auf Pixel 8a → URL öffnen
2. DSGVO-Hinweis → "Verstanden" → OAuth-Consent → Login
3. Patient anlegen → App schließen → App neu öffnen → Daten sofort da (Auto-Load)
4. Chrome-Browserdaten löschen → App neu öffnen → Login → Daten aus Drive restauriert
5. "Zum Home-Bildschirm hinzufügen" → Launcher-Icon tappen → App startet standalone

---

## 17. Glossar

| Begriff | Bedeutung |
|---|---|
| **appData** | Das vollständige In-Memory-Datenobjekt mit allen Patienten, Sessions, Supervisionen, Gruppen und Settings. Singleton in `state.js`. |
| **appDataFolder** | Ein spezieller, pro-App privater Bereich im Google Drive des Nutzers. Über den `drive.appdata`-OAuth-Scope erreichbar. Für den Nutzer in der Drive-UI unsichtbar. |
| **CSP** | Content Security Policy — HTTP-Header (oder Meta-Tag), der erlaubt, von welchen Origins Skripte, Styles etc. geladen werden dürfen. |
| **DoD** | Definition of Done — Abnahmekriterien für eine Phase. |
| **DSGVO** | Datenschutz-Grundverordnung (EU). Regelt den Umgang mit personenbezogenen Daten. |
| **GIS** | Google Identity Services — die aktuelle JavaScript-Library für OAuth bei Google (`accounts.google.com/gsi/client`). |
| **IDB** | IndexedDB — browserseitige transaktionale Datenbank. Primärer lokaler Speicher in Phase 1. |
| **INP** | Interaction to Next Paint — Web-Vital-Metrik für gefühlte Reaktionsgeschwindigkeit nach Nutzer-Interaktion. |
| **Kontingent** | Das vom Kostenträger bewilligte Stundenbudget für einen Patienten (z.B. 60 bei Langzeittherapie). |
| **PiA** | Psychologische:r Psychotherapeut:in in Ausbildung. |
| **Probatorik** | Probatorische Sitzungen — Kennenlern-/Diagnostik-Sitzungen vor dem eigentlichen Therapieantrag. |
| **PsychThG** | Psychotherapeutengesetz. Rechtliche Grundlage der PP-Ausbildung. |
| **PWA** | Progressive Web App — installierbare Web-Anwendung mit Offline-Fähigkeit und App-ähnlichem Verhalten. |
| **renderAll()** | Zentrale Render-Funktion, die alle sichtbaren Views neu aufbaut nach jeder Mutation. |
| **Supervisionsverhältnis** | Das Verhältnis zwischen Behandlungsstunden und Supervisionsstunden. Gesetzlich: mindestens 1:4 (eine Supervisionsstunde pro vier Behandlungsstunden). |
| **TTI** | Time to Interactive — Zeitdauer vom App-Start bis zur vollständigen Interaktivität. |
| **v0 / v1 / v2** | Schema-Versionen des `appData`-Formats. v0 = implizit, kein Versionsfeld (Legacy). v1 = aktueller Stand. |
