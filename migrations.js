// migrations.js
// Append-only Schema-Migrationen. §3 / §10.3 / §10.6.
//
// Regel: Einmal released, darf eine Migration nie editiert oder umsortiert
// werden. Neue Versionen werden ans Ende angehängt.

export const CURRENT_VERSION = 2;

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
