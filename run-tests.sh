#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# run-tests.sh — Führt Tests für einen bestimmten App-Bereich aus
#
# Nutzung:
#   ./run-tests.sh <bereich>              # nur direkte Tests
#   ./run-tests.sh <bereich> --indirect   # direkte + indirekte Tests
#   ./run-tests.sh --list                 # zeigt alle Bereiche
#
# Beispiele:
#   ./run-tests.sh formulare
#   ./run-tests.sh patienten --indirect
#   ./run-tests.sh alle
# ─────────────────────────────────────────────────────────────
set -euo pipefail

MAPPING="test-mapping.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAPPING_PATH="$SCRIPT_DIR/$MAPPING"

if [[ ! -f "$MAPPING_PATH" ]]; then
  echo "Fehler: $MAPPING nicht gefunden in $SCRIPT_DIR"
  exit 1
fi

# --list: Bereiche auflisten
if [[ "${1:-}" == "--list" ]]; then
  echo "Verfügbare Bereiche:"
  echo ""
  node --input-type=commonjs -e "
    const m = require('$MAPPING_PATH');
    for (const [k, v] of Object.entries(m.bereiche)) {
      const d = v.direct.length;
      const i = v.indirect.length;
      console.log('  ' + k.padEnd(16) + v.beschreibung + ' [' + d + ' direkt, ' + i + ' indirekt]');
    }
  "
  exit 0
fi

if [[ -z "${1:-}" ]]; then
  echo "Nutzung: $0 <bereich> [--indirect]"
  echo "         $0 --list"
  exit 1
fi

BEREICH="$1"
INCLUDE_INDIRECT="${2:-}"

# Testdateien aus Mapping auslesen
FILES=$(node --input-type=commonjs -e "
  const m = require('$MAPPING_PATH');
  const b = m.bereiche['$BEREICH'];
  if (!b) { console.error('Unbekannter Bereich: $BEREICH'); process.exit(1); }
  const files = new Set(b.direct);
  if ('$INCLUDE_INDIRECT' === '--indirect') {
    b.indirect.forEach(f => files.add(f));
  }
  console.log([...files].join('\n'));
")

if [[ -z "$FILES" ]]; then
  echo "Keine Tests für Bereich '$BEREICH' gefunden."
  exit 1
fi

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo "═══════════════════════════════════════════════════"
echo "Bereich: $BEREICH"
if [[ "$INCLUDE_INDIRECT" == "--indirect" ]]; then
  echo "Modus:   direkt + indirekt betroffene Tests"
else
  echo "Modus:   nur direkt betroffene Tests"
fi
echo "Dateien: $COUNT"
echo "$FILES" | sed 's/^/  → /'
echo "═══════════════════════════════════════════════════"
echo ""

# Playwright aufrufen mit den ermittelten Dateien
cd "$SCRIPT_DIR"
npx playwright test $FILES --reporter=list
