# Browser Test Run — Scenario Archiving

**Date:** 2026-02-05
**Port:** 5560
**Browser:** Chromium
**Feature file:** `specs/scenarios/scenario-deletion.feature`

## Scenarios Tested

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Archive a single scenario via row action menu | PASS | Row menu shows "Archive", confirmation modal shows scenario name + undo message. Scenario removed from list after confirm. |
| 2 | Batch archive multiple selected scenarios | PASS | Select all checks both rows, batch bar shows "2 selected". Confirmation modal shows "Archive 2 scenarios?" listing both. Both removed after confirm. |

## Setup Notes

- Auth required: Yes — signed up new account `local-agent-tester@langwatch.ai` via Auth0
- Test data: Created 3 scenarios via "New Scenario" > "I'll write it myself" (1 for single archive test, 2 for batch test)
- Port issues: Initially tried port 5561 (app running outside Docker), Auth0 callback was hardcoded to 5560 in `.env`. Fixed by adding `NEXTAUTH_URL` and `BASE_HOST` overrides in `compose.dev.yml` that use `${APP_PORT:-5560}`.

## Issues Encountered

1. **Auth0 callback port mismatch** — First attempt failed because `NEXTAUTH_URL` in `.env` was `http://localhost:5560` but app was on 5561. Auth0 redirected to 5560 which wasn't running. Fixed in `compose.dev.yml` with dynamic `${APP_PORT}`.

2. **Very slow page loads** — Dev mode Turbopack compilation took 20-30 seconds per new page. The splash screen with orange bar appeared while pages compiled.

3. **Duplicate dialogs** — "New Scenario" > "I'll write it myself" opened two stacked drawer dialogs. Had to press Escape twice to close both.

4. **Chakra checkbox click intercepted** — Clicking the ToS checkbox on onboarding failed with "intercepts pointer events". Fixed by clicking the label text instead.

5. **Scenario name not auto-saved** — Filling in the name in the editor drawer and pressing Escape didn't save the name. Scenarios remained "Untitled". This is expected — the name saves on explicit Save, not on close.

## Screenshots

- `.playwright-mcp/page-2026-02-05T15-28-04-676Z.png` — Splash/loading screen
- `.playwright-mcp/page-2026-02-05T15-47-28-350Z.png` — Compile bar stuck
- `.playwright-mcp/page-2026-02-05T15-48-09-985Z.png` — Still compiling
- `.playwright-mcp/page-2026-02-05T15-49-03-997Z.png` — Still compiling (simulations page)

## Observations

- The "New Scenario" flow always opens a "No model provider" dialog first, requiring "I'll write it myself" click. This is expected for projects without a configured LLM provider.
- The batch action bar UI works cleanly — appears on selection, shows count, disappears when all deselected.
- Archive confirmation modals correctly differentiate between single ("Archive scenario?") and batch ("Archive 2 scenarios?") with appropriate content.
- The `scenarios.archive` and `scenarios.batchArchive` mutations are separate endpoints, both working correctly.
