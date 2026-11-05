# Release blockers after the finance fixes

This branch is not a verified production release.

Implemented by the guarded workflow: ID-based budget export/import; financial total validation; explicit rejection of empty/negative amounts; loan-only state saves; canonical JSON saved after sheet projections; best-effort snapshot restoration on caught write failures; calendar retry trigger for manual goal edits; campaign refresh events; cancelled-goal and currency display fixes; regenerated embedded Apps Script bundle.

Still required before production:
- Authenticated access to Apps Script, Sheets and Calendar: actual deployment settings have not been inspected or changed.
- True optimistic concurrency with base revisions and acknowledged client writes. Timestamp comparison remains a legacy limitation.
- Durable recovery for execution timeout/process termination. In-memory rollback only handles caught errors.
- Integration testing on a backup/test spreadsheet, including legacy data validation, installed calendar trigger, two devices and mobile browsers.

No automatic merge to main or Google deployment is part of this workflow.
