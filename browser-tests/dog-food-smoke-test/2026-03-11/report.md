# Browser Test: dog-food-smoke-test
**Date:** 2026-03-11
**App:** http://localhost:5561
**Browser:** Chromium (headless)
**Branch:** issue2216/enable-ai-agents-to-browser-test-own-code
**PR:** #2217

## Results

| # | Scenario | Result | Screenshot |
|---|----------|--------|------------|
| 1 | App loads on isolated dev instance (port 5561) | PASS | screenshots/01-dashboard-signed-in.jpeg |
| 2 | Sign-in page renders with Email + Password form | PASS | screenshots/02-sign-in-page.jpeg |
| 3 | Sign in with test credentials and dashboard renders | PASS | screenshots/03-dashboard-after-signin.jpeg |
| 4 | Navigate to Plans comparison page (Free/Growth/Enterprise) | PASS | screenshots/04-plans-page.jpeg |

## Failures
None.

## Notes
- Dev instance started via `scripts/dev-up.sh`, allocated port 5561 automatically (5560 was in use)
- First page load after sign-in takes ~15s due to Turbopack compilation in dev mode
- Session cookies persist across browser close/reopen — logout + re-login was needed to prove full auth flow
- The `currency.detectCurrency` tRPC query fails on plans page (procedure not found in lite/self-hosted mode) — cosmetic only, plans still render correctly
- React DOM nesting warnings (descendant errors) are pre-existing Chakra UI issues, not related to this PR
- All verification done autonomously using Playwright MCP tools — no manual intervention
