# Finplane — status before production deployment

## Completed in this change
- Removed obsolete `index-v2.html`; `index.html` remains the GitHub Pages entry point.
- Replaced the embedded Apps Script source in `index.html` with the complete bundle from `AppsScript_Complete.gs`. The embedded source is byte-for-byte identical to the standalone bundle.
- Kept the POST payload's `updatedAt` and `gameAchievements` fields aligned with the backend contract.
- The client now attempts synchronization when the only non-empty data is the family-achievements log.
- The client restores `gameAchievements` when pulling the complete server state.
- The client does not treat an opaque `no-cors` POST as proof of success; it verifies the exact `clientUpdatedAt` via the GET status endpoint.

## Still required before calling production synchronization verified
1. Install the complete `AppsScript_Complete.gs` bundle in the Apps Script project bound to the **backup spreadsheet first**. Keep a single `Code.gs` file; do not leave duplicate module files.
2. Deploy a new Web App version and check that GET `?ts=1` returns both numeric fields: `updatedAt` and `clientUpdatedAt`.
3. Run integration tests on the backup spreadsheet: full-state POST/GET round trip, budget operation IDs, goals, loans, family achievements, calendar events, and manual sheet edits.
4. Test concurrent edits from two devices. Timestamp checks are a legacy conflict guard, not a full base-revision protocol.
5. Add request authentication before exposing a write endpoint publicly. Current Apps Script handlers do not authenticate POST requests; the Web App URL must be treated as a secret until this is fixed.
6. Test recovery from Apps Script execution timeout or process termination. Snapshot rollback handles caught exceptions only; it cannot guarantee recovery after a hard termination.

## Important
- This repository change does not edit Google Sheets, Calendar, Apps Script project settings, or the active Web App deployment.
- Do not deploy the new bundle to the original spreadsheet until the backup integration tests pass.
- Do not use `resetToDefaultData` on a live family spreadsheet.
