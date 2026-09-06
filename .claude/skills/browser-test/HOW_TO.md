# Browser Test — How To Guide

Lessons learned from running `/browser-test` against the LangWatch app.

## Before Starting

1. **Check the port is reachable** — try `browser_navigate` first. If it fails with `ERR_CONNECTION_REFUSED` or `ERR_CONNECTION_RESET`, the app isn't ready. Docker containers can take 1-2 minutes for migrations + compilation.

2. **The first load is slow** — the browser application is a Vite SPA; the dev server
   compiles a route's chunks on first visit. Expect tens of seconds, not minutes. Use
   `browser_wait_for` with `time: 60` for a first page load.

3. **Origin mismatch kills auth** — the trusted origin comes from `NEXTAUTH_URL`
   (bound in `apps/api/src/platform/config/api.config.ts`; auth itself is better-auth).
   It must match the origin you are browsing. Under haven, `.env.portless` sets it to the
   real `https://app.<slug>.langwatch.localhost:<port>`, so browsing the app on
   `127.0.0.1` will 403 the sign-in. Under a plain `pnpm dev`, `PORT` must match.

## Authentication

- Local dev uses an email + password credentials form, not a third-party identity
  provider. Navigating to the app URL redirects to `/auth/signin`.
- For fresh accounts, click **"Register new account"** on the sign-in page, fill in the credentials, then sign in.
- After successful login, the app redirects to the dashboard. The dev server may show a loading splash while it builds the route's chunks — wait up to 60s.
- **New accounts hit onboarding** — you'll need to fill in an org name (`Browser Test Org`), accept ToS, and pick a product flavour before reaching the main app.
- After auth, you should see the dashboard with "Hello, Browser" and "Browser Test Org" in the header.

### Standard Test Credentials

See SKILL.md sub-agent template for current credentials. They're shared across `/browser-test`, `dev/scripts/verify-browser-test.js`, `dev/tests/agentic-e2e/tests/auth.setup.ts`, and interactive runs.

## Data Seeding

Many features require existing data to be testable. The sub-agent should create this data before verification begins.

### Common Seeding Patterns

**Creating a suite:**

1. Navigate to the Suites page from the sidebar
2. Click the "Create Suite" (or "New Suite") button
3. Fill in the suite name (e.g., "Test Suite") and any required fields
4. Save/submit the form
5. Verify the suite appears in the list before proceeding

**Triggering test runs / batch runs:**

1. Open an existing suite
2. Click "Run" or "Run All" to trigger execution
3. Wait for the run status to change from "Running" to "Completed" — use `browser_wait_for` with a generous timeout (60-120s)
4. Refresh or re-navigate if the status does not update automatically

**Waiting for results to appear:**

- After triggering runs or sending traces, data may take a few seconds to propagate
- Use `browser_wait_for` with `text` matching (e.g., wait for "Completed" or a result count) rather than fixed sleeps
- If results depend on background workers, allow up to 120s

**Creating traces via the SDK or API:**

- Use a quick Bash command to send traces when UI seeding is impractical. The payload below is illustrative — replace placeholders with valid values:
  ```bash
  curl -X POST http://localhost:<port>/api/collector \
    -H "X-Auth-Token: <project-api-key>" \
    -H "Content-Type: application/json" \
    -d '<valid trace payload JSON>'
  ```
- Find the project API key on the project settings page in the UI

**Creating evaluations:**

- Evaluations typically require traces to already exist
- Navigate to the Evaluations section, configure an evaluator, and run it against existing traces

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

Screenshots are uploaded to img402.dev (not committed to git). See SKILL.md Step 5 for upload instructions. **Never commit `browser-tests/`** — it is gitignored.

## After Finishing

1. **Save report** to `browser-tests/<feature-name>/<YYYY-MM-DD>/report.md` (see SKILL.md for format).
2. **Report results** to the caller using the summary table format from `SKILL.md`.

## Example Run

See `browser-tests/proof-of-concept/` for a complete proof-of-concept run with screenshots, raw logs, and a report. This was the first successful AI-driven browser verification against a local dev instance.

## Known Issues

| Issue                                      | Workaround                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| First route load stalls past 60s           | Hard refresh: `browser_navigate` to the same URL                          |
| Sign-in 403s                               | The origin does not match `NEXTAUTH_URL` — browse the configured hostname |
| "New Scenario" opens duplicate dialogs     | Press Escape twice to close both                                          |
| Checkbox click intercepted by overlay      | Click the label or img element next to the checkbox                       |
| Page shows splash but queries all resolved | Wait longer — the dev server is still building the route's chunks         |
