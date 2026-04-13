// migrations.js
// Append-only Schema-Migrationen. §3 / §10.3 / §10.6.
//
// Regel: Einmal released, darf eine Migration nie editiert oder umsortiert
// werden. Neue Versionen werden ans Ende angehängt.

export const CURRENT_VERSION = 4;

/**
 * MIGRATIONS[i] = { from: n, to: n+1, up: (data) => data }
 * Jede `up`-Funktion muss eine reine Funktion sein: keine Seiteneffekte,
 * Eingabe wird nicht mutiert, Ausgabe ist das migrierte Objekt.
 */
export const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    up(data) {
      // Legacy-Single-File-Struktur (ohne `version`-Feld) → v1.
      // Defaults für fehlende Felder setzen; existierende Werte bleiben erhalten.
      const next = {
        version: 1,
        settings: {
          supervisionRatio: 4,
          defaultKontingent: 60,
          ...(data.settings && typeof data.settings === 'object' ? data.settings : {}),
        },
        patients: Array.isArray(data.patients) ? data.patients.slice() : [],
        sessions: Array.isArray(data.sessions) ? data.sessions.slice() : [],
        supervisions: Array.isArray(data.supervisions) ? data.supervisions.slice() : [],
        supervisionGroups: Array.isArray(data.supervisionGroups) ? data.supervisionGroups.slice() : [],
      };
      // Sessions & Supervisions: defensiv unvollständige Einträge auslassen
      // wäre ein anderer Schritt — hier bewahren wir den Input 1:1 und lassen
      // die Validierung vor dem Aufruf entscheiden.
      return next;
    },
  },
  {
    from: 1,
    to: 2,
    up(data) {
      // v2: settings.lastLocalExportAt (ISO-Timestamp des letzten manuellen
      // JSON-Exports über den Daten-Tab). Speist den 4-Wochen-Reminder-Banner
      // in renderDataTab (§17.5). Default für bestehende Installationen ist
      // `null` — das triggert sofort den Banner "Du hast noch kein lokales
      // Backup erstellt", was bei aktiven Bestandsnutzern beabsichtigt ist,
      // weil der Rollback-Pfad laut §17.5 ausschließlich über lokale Exporte
      // verläuft und diese Hygiene früher begonnen werden sollte als später.
      return {
        ...data,
        settings: {
          ...(data.settings && typeof data.settings === 'object' ? data.settings : {}),
          lastLocalExportAt:
            data.settings && typeof data.settings.lastLocalExportAt === 'string'
              ? data.settings.lastLocalExportAt
              : null,
        },
      };
    },
  },
  {
    from: 2,
    to: 3,
    up(data) {
      // v3: Forecast-Feature "Prüfungs-Fahrplan".
      //
      // Neue Felder:
      //   settings.forecast = {
      //     abschlusskontrolleId:    string|null — gewählter Termin aus ABSCHLUSSKONTROLLEN
      //     targetHours:             number     — Zielstunden (default 600)
      //     sickWeeksPerYear:        number     — Ausfallwochen/Jahr (default 4)
      //     vacationWeeksPerYear:    number     — Urlaubswochen/Jahr (default 6)
      //     dropoutRate:             number     — Patientenabbruchquote (default 0.30)
      //     currentPatientCount:     number     — Startwert der Patienten-Stufenfunktion
      //     startDateOverride:       string|null — ISO-Datum oder null (dann aus sessions)
      //   }
      //   forecastIntakes = []   — Stufenweise Patientenaufnahme-Plan:
      //     { id, date: ISO, addCount: int, note?: string }
      //
      // Bestehende Installationen bekommen Defaults. Keine fachliche Ableitung
      // aus den bestehenden Patienten — der User pflegt den Forecast bewusst.
      const prevSettings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
      const prevForecast = (prevSettings.forecast && typeof prevSettings.forecast === 'object') ? prevSettings.forecast : {};
      return {
        ...data,
        settings: {
          ...prevSettings,
          forecast: {
            abschlusskontrolleId:
              typeof prevForecast.abschlusskontrolleId === 'string' ? prevForecast.abschlusskontrolleId : null,
            targetHours:
              typeof prevForecast.targetHours === 'number' && Number.isFinite(prevForecast.targetHours) && prevForecast.targetHours > 0
                ? prevForecast.targetHours
                : 600,
            sickWeeksPerYear:
              typeof prevForecast.sickWeeksPerYear === 'number' && Number.isFinite(prevForecast.sickWeeksPerYear) && prevForecast.sickWeeksPerYear >= 0
                ? prevForecast.sickWeeksPerYear
                : 4,
            vacationWeeksPerYear:
              typeof prevForecast.vacationWeeksPerYear === 'number' && Number.isFinite(prevForecast.vacationWeeksPerYear) && prevForecast.vacationWeeksPerYear >= 0
                ? prevForecast.vacationWeeksPerYear
                : 6,
            dropoutRate:
              typeof prevForecast.dropoutRate === 'number' && Number.isFinite(prevForecast.dropoutRate) && prevForecast.dropoutRate >= 0 && prevForecast.dropoutRate < 1
                ? prevForecast.dropoutRate
                : 0.30,
            currentPatientCount:
              typeof prevForecast.currentPatientCount === 'number' && Number.isFinite(prevForecast.currentPatientCount) && prevForecast.currentPatientCount >= 0
                ? prevForecast.currentPatientCount
                : 0,
            startDateOverride:
              typeof prevForecast.startDateOverride === 'string' ? prevForecast.startDateOverride : null,
          },
        },
        forecastIntakes: Array.isArray(data.forecastIntakes) ? data.forecastIntakes.slice() : [],
      };
    },
  },
  {
    from: 3,
    to: 4,
    up(data) {
      // v4: Therapiephasen-Tracking & Bewilligungs-Struktur.
      //
      // Sessions:
      //   - type 'probatorik' → type 'einzel', phase 'probatorik'
      //   - type 'gruppe' → type 'einzel' (Sicherheitsnetz)
      //   - Alle Nicht-Probatorik-Sessions bekommen `phase` berechnet anhand
      //     der chronologischen Reihenfolge pro Patient.
      //
      // Patients:
      //   - kontingent (Zahl) → bewilligt-Objekt.
      //     kontingent bleibt als Legacy-Feld erhalten.
      //
      // SESSION_TYPES ist jetzt ['einzel', 'doppel', 'probatorik'].

      const sessions = Array.isArray(data.sessions) ? data.sessions.slice() : [];
      const patients = Array.isArray(data.patients) ? data.patients.slice() : [];

      // Phase 1: Session-Typen normalisieren
      const migratedSessions = sessions.map(s => {
        const next = { ...s };
        if (s.type === 'probatorik') {
          next.type = 'einzel';
          next.phase = 'probatorik';
        } else if (s.type === 'gruppe') {
          next.type = 'einzel';
          // gruppe-Sessions werden als reguläre Kontingent-Sitzungen gezählt
          // → Phase wird unten berechnet.
        }
        return next;
      });

      // Phase 2: Nicht-Probatorik-Sessions pro Patient chronologisch
      // durchnummerieren und Phase zuweisen.
      const patientNonProba = {};
      // Sortieren: aufsteigend nach Datum, dann nach Array-Index (stabil)
      const sortedForPhase = migratedSessions
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.phase !== 'probatorik')
        .sort((a, b) => a.s.date.localeCompare(b.s.date) || a.idx - b.idx);

      for (const { s } of sortedForPhase) {
        if (!patientNonProba[s.patientId]) patientNonProba[s.patientId] = 0;
        patientNonProba[s.patientId]++;
        const n = patientNonProba[s.patientId];

        // Patienten-Kontingent bestimmt die Grenzen für die Migration.
        // Da wir die bewilligt-Struktur noch nicht haben, leiten wir aus
        // dem bisherigen kontingent-Feld ab.
        const patient = patients.find(p => p.id === s.patientId);
        const kontingent = (patient && typeof patient.kontingent === 'number') ? patient.kontingent : 60;

        // Für die Migration: Phase basierend auf Position zuweisen.
        // Bis 12 → kzt1, 13–24 → kzt2, 25–kontingent → lzt,
        // kontingent+1–80 → lzt_v
        if (n <= 12) {
          s.phase = 'kzt1';
        } else if (n <= 24) {
          s.phase = 'kzt2';
        } else if (n <= kontingent) {
          s.phase = 'lzt';
        } else {
          s.phase = 'lzt_v';
        }
      }

      // Probatorik-Sessions ohne phase-Feld (edge case: wurde oben schon gesetzt)
      for (const s of migratedSessions) {
        if (!s.phase) s.phase = 'kzt1'; // Fallback für unerwartete Fälle
      }

      // Phase 3: Patienten-bewilligt-Objekt aus kontingent ableiten.
      const migratedPatients = patients.map(p => {
        const next = { ...p };
        const k = (typeof p.kontingent === 'number' && Number.isFinite(p.kontingent)) ? p.kontingent : 60;

        // Bewilligungs-Ableitung aus bisherigem kontingent:
        // Logik: Zähle wie viele Nicht-Probatorik-Sessions der Patient hat,
        // um zu sehen welche Phasen er faktisch schon betreten hat.
        const actualCount = patientNonProba[p.id] || 0;

        const bewilligt = {
          kzt1: true, // immer
          kzt2: k > 12 || actualCount > 12,
          lzt: k > 24 || actualCount > 24,
          lztMax: k > 24 ? Math.max(k, 60) : 60,
          lztV: k > 60 || actualCount > 60,
          lztVMax: k > 60 ? Math.max(k, 80) : 80,
        };

        next.bewilligt = bewilligt;
        return next;
      });

      return {
        ...data,
        sessions: migratedSessions,
        patients: migratedPatients,
      };
    },
  },
];

/**
 * Wendet alle anwendbaren Migrationen auf das Input-Objekt an.
 *
 * Garantien laut §10.3:
 * - Pre-Migration-Snapshot wird intern gehalten und bei Fehler zurückgegeben
 * - Bei Erfolg: das migrierte Objekt mit `version === CURRENT_VERSION`
 * - Bei `version > CURRENT_VERSION`: Fehler, Aufrufer muss §10.5 anwenden
 *
 * @param {object} data — vorvalidierter appData-Kandidat
 * @returns {{ ok: true, data: object } | { ok: false, error: string, rollback: object }}
 */
export function runMigrations(data) {
  // Strukturellen Snapshot für Rollback halten. structuredClone ist in Node 20+
  // und modernen Browsern verfügbar (§4.11 Web-API-Mindestanforderungen).
  const snapshot = structuredClone(data);

  let current = structuredClone(data);
  let currentVersion = typeof current.version === 'number' ? current.version : 0;

  if (currentVersion > CURRENT_VERSION) {
    return {
      ok: false,
      error: `version ${currentVersion} > CURRENT_VERSION ${CURRENT_VERSION} — App aktualisieren`,
      rollback: snapshot,
    };
  }

  if (currentVersion === CURRENT_VERSION) {
    return { ok: true, data: current };
  }

  try {
    for (const mig of MIGRATIONS) {
      if (currentVersion < mig.to) {
        if (currentVersion !== mig.from) {
          throw new Error(`migration gap: at v${currentVersion} but next migration is ${mig.from}→${mig.to}`);
        }
        current = mig.up(current);
        current.version = mig.to;
        currentVersion = mig.to;
      }
    }
    if (currentVersion !== CURRENT_VERSION) {
      throw new Error(`post-migration version ${currentVersion} ≠ CURRENT_VERSION ${CURRENT_VERSION}`);
    }
    return { ok: true, data: current };
  } catch (err) {
    return {
      ok: false,
      error: `Migration fehlgeschlagen: ${err.message}`,
      rollback: snapshot,
    };
  }
}
