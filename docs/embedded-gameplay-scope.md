# Embedded goal gameplay: first implementation package

This package adds a pure goal-funding calculation and tests. It is NOT loaded into index.html yet, does not remove the campaign HUD yet and does not modify financial state, Google Sheets or Apps Script.

allocate(goals, availableRub, eurRate) expects the already-verified amount available specifically for goals, AFTER reserves/obligations handled by the financial model. It must never receive total income or an unrestricted total account balance. Allocation is a display calculation, not a real reservation or transfer. Amounts are represented in kopecks. Goals are ordered by deadline, then stable ID. Closed/cancelled goals are excluded; zero-price goals and unsupported currencies cannot unlock via funding.

fundingEvents(previous, next, event, seen) emits progress/unlock candidates only for a confirmed deposit with a stable actionId and an increased goal budget. The caller must provide real save acknowledgement and persist the seen-event journal. This function alone does not solve cross-device idempotency or the legacy no-cors acknowledgement problem.

Next: inspect extracted source hooks; remove the large HUD; wire progress into actual goal cards; add local icons and the prepared praise catalogue; optional sound; Realize opens existing purchase confirmation; Later dismisses a notification without completing the goal. Test initial loads, sync, refunds, balance decreases, failed saves and repeated clicks before merging.

The workflow only runs core tests and creates read-only source extracts for integration review. It does not publish the feature to main or deploy Google.
