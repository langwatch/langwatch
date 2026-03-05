# Browser Test — How To Guide

Lessons learned from running `/browser-test` against the LangWatch app.

## Before Starting

1. **Check the port is reachable** — try `browser_navigate` first. If it fails with `ERR_CONNECTION_REFUSED` or `ERR_CONNECTION_RESET`, the app isn't ready. Docker containers can take 1-2 minutes for migrations + compilation.

2. **Dev mode is slow** — First visit to any page triggers Turbopack compilation. Expect **60-120 second waits** per new page. The orange bar at the top of the screen is the compilation indicator. Don't panic — just wait. Use `browser_wait_for` with `time: 120` for first page loads.

3. **Port mismatch kills auth** — `NEXTAUTH_URL` in `.env` must match the port the app is actually running on. If using `make quickstart` / `dev.sh`, the port auto-detects starting from 5560. The `compose.dev.yml` overrides `NEXTAUTH_URL` with `${APP_PORT:-5560}` so Docker should be fine. If running `pnpm dev` directly and the port increments (e.g. to 5561), auth callbacks will break.

## Authentication

- The app uses **Auth0** for login. Navigating to `/auth/signin` triggers a redirect to Auth0's hosted login page.
- For fresh accounts, you need to **sign up first** — Auth0 will show a "Sign up" link on the login page.
- After signup, Auth0 shows an **OAuth consent screen** — click "Accept".
- After successful login, the app redirects back and shows a loading splash while queries resolve. Wait for it.
- **New accounts hit onboarding** — you'll need to fill in an org name, accept ToS, and pick a product flavour before reaching the main app.

## Chakra UI Gotchas

- **Checkbox clicks get intercepted** by Chakra's overlay `<div>`. If clicking a checkbox times out with "intercepts pointer events", click the **label text** or the **adjacent img element** instead.
- **Dialogs sometimes stack** — the "New Scenario" flow can open multiple drawers. Press `Escape` multiple times to close them all.

## Interaction Tips

- **Use `browser_snapshot`** for all interactions — it returns the accessibility tree with element refs. Only use `browser_take_screenshot` for evidence of failures.
- **Wait generously** — use `browser_wait_for` with 60-120 seconds for first page loads, 10-30 seconds for subsequent transitions. Dev mode compilation is the bottleneck.
- **Check console logs** in snapshot events — tRPC query/mutation logs show what API calls are happening (`>> query` = request, `<< query` = response). This tells you if data is loading or if something failed.
- **Escape closes dialogs** — prefer `browser_press_key Escape` over clicking Close buttons to avoid intercepted-click issues.

## Screenshots

Always save screenshots to `.browser-test-screenshots/` (gitignored). Never save to repo root.

```text
browser_take_screenshot → filename: ".browser-test-screenshots/my-screenshot.png"
```

## After Finishing

1. **Save run notes** in `.claude/skills/browser-test/history/` using the template in `_TEMPLATE.md`.
2. **Report results** using the summary table format from `SKILL.md`.

## Known Issues

| Issue | Workaround |
|-------|-----------|
| Orange compile bar stuck for >60s | Hard refresh: `browser_navigate` to the same URL |
| Auth callback goes to wrong port | Ensure `NEXTAUTH_URL` matches actual port, or use Docker which overrides it |
| "New Scenario" opens duplicate dialogs | Press Escape twice to close both |
| Checkbox click intercepted by overlay | Click the label or img element next to the checkbox |
| Page shows splash but queries all resolved | Wait longer — Turbopack is still compiling the page JS |
