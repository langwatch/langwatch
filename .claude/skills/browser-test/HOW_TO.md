# Browser Test — How To Guide

Lessons learned from running `/browser-test` against the LangWatch app.

## Before Starting

1. **Check the port is reachable** — try `browser_navigate` first. If it fails with `ERR_CONNECTION_REFUSED` or `ERR_CONNECTION_RESET`, the app isn't ready. Docker containers can take 1-2 minutes for migrations + compilation.

2. **Dev mode is slow** — First visit to any page triggers Turbopack compilation. Expect **60-120 second waits** per new page. The orange bar at the top of the screen is the compilation indicator. Don't panic — just wait. Use `browser_wait_for` with `time: 120` for first page loads.

3. **Port mismatch kills auth** — `NEXTAUTH_URL` in `.env` must match the port the app is actually running on. If using `make quickstart` / `dev.sh`, the port auto-detects starting from 5560. The `compose.dev.yml` overrides `NEXTAUTH_URL` with `${APP_PORT:-5560}` so Docker should be fine. If running `pnpm dev` directly and the port increments (e.g. to 5561), auth callbacks will break.

## Authentication

- Local dev uses **NextAuth credentials** (not Auth0). Navigating to the app URL redirects to `/auth/signin` — a simple Email + Password form with a "Sign in" button.
- For fresh accounts, click **"Register new account"** on the sign-in page, fill in the credentials, then sign in.
- After successful login, the app redirects to the dashboard. Dev mode may show a loading splash while Turbopack compiles — wait up to 120s.
- **New accounts hit onboarding** — you'll need to fill in an org name (`Browser Test Org`), accept ToS, and pick a product flavour before reaching the main app.
- After auth, you should see the dashboard with "Hello, Browser" and "Browser Test Org" in the header.

### Standard Test Credentials

Always use these credentials — they're shared across `/browser-test`, the stable E2E suite, and verification scripts:

- **Email:** `browser-test@langwatch.ai`
- **Password:** `BrowserTest123!`
- **Org name (onboarding):** `Browser Test Org`

Used by `scripts/verify-browser-test.js`, `agentic-e2e-tests/tests/auth.setup.ts`, and interactive `/browser-test` runs. One set of credentials means one test account and reusable auth state across all tools.

## Chakra UI Gotchas

- **Checkbox clicks get intercepted** by Chakra's overlay `<div>`. If clicking a checkbox times out with "intercepts pointer events", click the **label text** or the **adjacent img element** instead.
- **Dialogs sometimes stack** — the "New Scenario" flow can open multiple drawers. Press `Escape` multiple times to close them all.

## Interaction Tips

- **Use `browser_snapshot`** for all interactions — it returns the accessibility tree with element refs. Only use `browser_take_screenshot` for evidence of failures.
- **Wait generously** — use `browser_wait_for` with 60-120 seconds for first page loads, 10-30 seconds for subsequent transitions. Dev mode compilation is the bottleneck.
- **Check console logs** in snapshot events — tRPC query/mutation logs show what API calls are happening (`>> query` = request, `<< query` = response). This tells you if data is loading or if something failed.
- **Escape closes dialogs** — prefer `browser_press_key Escape` over clicking Close buttons to avoid intercepted-click issues.

## Screenshots

Save screenshots to the local artifact directory: `browser-tests/<feature-name>/<YYYY-MM-DD>/screenshots/`.

```text
browser_take_screenshot → filename: "browser-tests/plans-comparison/2026-03-11/screenshots/01-sign-in.png"
```

Screenshots are **uploaded to img402.dev** (not committed to git). Upload via:
```bash
curl -s -F "image=@<path>" https://img402.dev/api/free
# Returns: {"url":"https://i.img402.dev/abc123.jpg", ...}
```

Use the returned `https://i.img402.dev/...` URLs in PR descriptions. **Never commit `browser-tests/`** — it is gitignored. Free tier: 1MB max, 7-day retention.

## After Finishing

1. **Save report** to `browser-tests/<feature-name>/<YYYY-MM-DD>/report.md` (see SKILL.md for format).
2. **Report results** to the caller using the summary table format from `SKILL.md`.

## Example Run

See `browser-tests/proof-of-concept/` for a complete proof-of-concept run with screenshots, raw logs, and a report. This was the first successful AI-driven browser verification against a local dev instance.

## Known Issues

| Issue | Workaround |
|-------|-----------|
| Orange compile bar stuck for >60s | Hard refresh: `browser_navigate` to the same URL |
| Auth callback goes to wrong port | Ensure `NEXTAUTH_URL` matches actual port, or use Docker which overrides it |
| "New Scenario" opens duplicate dialogs | Press Escape twice to close both |
| Checkbox click intercepted by overlay | Click the label or img element next to the checkbox |
| Page shows splash but queries all resolved | Wait longer — Turbopack is still compiling the page JS |
