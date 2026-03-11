# Browser Test: beta-pill
**Date:** 2026-03-11
**App:** http://localhost:5560
**Browser:** Chromium (headless)
**Branch:** issue2216/enable-ai-agents-to-browser-test-own-code
**PR:** #2217

## Results

| # | Scenario | Result | Screenshot |
|---|----------|--------|------------|
| 1 | Sign in and land on dashboard | PASS | screenshots/01-dashboard.jpeg |
| 2 | Sidebar shows "Beta" pill badge next to Suites | PASS | screenshots/02-sidebar-beta-pill.jpeg |
| 3 | Hover over Beta badge shows popover with disclaimer | PASS | screenshots/03-beta-popover.jpeg |

## Failures
None.

## Notes
- Beta badge found next to "Suites" item under the Simulations section in sidebar
- Popover text: "This feature is provided in beta and is still under development. By using it, you acknowledge it may contain errors, change without notice, or be discontinued at any time."
- Feature file has 6 scenarios tagged `@integration` — only Scenario 6 (sidebar beta indicator) is browser-verifiable; the other 5 test component internals and are covered by integration tests
- Session cookies persisted from previous run so sign-in was automatic
