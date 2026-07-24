# Browser Test Run — Scenario Deletion

**Date:** 2026-02-05
**Port:** 5560
**Browser:** Chromium
**Feature file:** `specs/scenarios/scenario-deletion.feature`

## Scenarios Tested

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Delete a single scenario via row action menu | PASS | Row action menu shows "Delete", modal title "Delete scenario?", warning "This action cannot be undone.", scenario removed from list after confirm |
| 2 | Batch delete multiple selected scenarios | PASS | Selecting 2 rows shows "2 selected" bar with "Delete" button, modal title "Delete 2 scenarios?", lists both names, both removed after confirm, empty state shown |
| 3 | "I'll write it myself" hidden when no model provider | PASS | Verified before adding provider: modal shows warning with no skip button. After adding provider: modal shows full AI form with skip button |

## Setup Notes

- Auth: Already logged in as existing user in "Agent Tester Org"
- Test data: Created 3 "Untitled" scenarios via "New Scenario" > "I'll write it myself"
- Feature flag: `RELEASE_UI_SIMULATIONS_MENU_ENABLED=1` added to compose.dev.yml, confirmed "Simulations" menu visible
- Model provider was initially not configured; added during session

## Issues Encountered

- Duplicate editor dialogs still open when creating a scenario (known issue from HOW_TO.md). Press Escape twice to close both.
- Volta can't parse `"24.x"` node version in package.json — tests must be run with `VOLTA_BYPASS=1` and explicit node path.

## Screenshots

None needed — all scenarios passed.

## Observations

- The rename from "Archive" to "Delete" is consistently applied across all UI surfaces: row action menu, batch action bar, confirmation modal title, and confirm button.
- Warning text correctly changed from "can be undone by an administrator" to "cannot be undone".
- Backend still calls `scenarios.archive` and `scenarios.batchArchive` mutations (soft delete), which is fine — the UI terminology is what changed.
