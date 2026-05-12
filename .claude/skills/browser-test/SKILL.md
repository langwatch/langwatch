---
name: browser-test
description: "Validate a feature works by driving a real browser with Playwright MCP. No test files — just interactive verification."
user-invocable: true
argument-hint: "[port] [feature description or feature-file-path]"
---

# Browser Test — Interactive Feature Validation

You are the **orchestrator**. You do NOT drive the browser yourself. You spawn a focused sub-agent to do the browser work, monitor its progress, and collect results.

## Step 1: Prepare

Parse `$ARGUMENTS` for:
- **Port** (optional): a number (e.g. `5570`) or `:<port>` format
- **Feature** (optional): a description of what to verify, or a path to a `specs/*.feature` file

If a feature file path is given, **read it now** and extract the scenarios into a concrete checklist. If a plain description is given, use it directly. If neither is provided, use the **default smoke test**: app loads, sign in works, dashboard renders after auth.

### Resolve the port

1. Explicit port in `$ARGUMENTS` → use it
2. Read `.dev-port` file in the repo root → source it for `APP_PORT`
3. **No port and no `.dev-port`?** → run `scripts/dev-up.sh` and then read the `.dev-port` it creates

```bash
# .dev-port format (written by dev-up.sh):
APP_PORT=5560
BASE_URL=http://localhost:5560
COMPOSE_PROJECT_NAME=langwatch-abcd1234
```

### Resolve the feature

If a feature file was given, read it and turn each scenario into a numbered verification step. Example:

```
Feature file: specs/features/beta-pill.feature
Scenarios:
  1. Navigate to dashboard → verify purple "Beta" badge next to Suites in sidebar
  2. Hover over badge → verify popover appears with beta disclaimer text
  3. Press Tab to focus badge → verify same popover appears via keyboard
```

### Create artifact directory

```
browser-tests/<feature-name>/<YYYY-MM-DD>/screenshots/
```

Derive `<feature-name>` from: feature filename (without extension) > slugified description > branch name suffix.

## Step 2: Determine data seeding needs

Before verification, decide what data the feature under test requires. Many features need pre-existing data to be meaningful (e.g., a suites page needs at least one suite with runs, a trace viewer needs traces, an evaluations dashboard requires completed evaluations).

1. **Analyze the verification steps** from Step 1. For each step, ask: "What data must already exist for this to be testable?"
2. **Build a seeding checklist** — the minimal set of entities needed. Examples:
   - Suites page → create one suite with a name and at least one scenario
   - Trace viewer → send at least one trace via the SDK or API
   - Evaluation results → trigger a batch run and wait for results
3. **Prefer seeding through the UI** — navigate to create forms, fill them in, submit. This exercises the same path a user would and is the most reliable approach in dev mode.
4. **Fall back to API/SDK only for bulk data** that would be impractical to create through the UI (e.g., 50 traces for a pagination test).
5. **Keep seeding MINIMAL** — only create what is strictly needed to verify the feature. Do not populate the app with extra data "just in case."

Include the seeding instructions in the sub-agent prompt (Step 3) so the sub-agent creates the data before verifying.

## Step 3: Spawn the browser agent

Use the **Agent tool** to spawn a sub-agent. Give it everything it needs in the prompt — port, verification steps, credentials, artifact path. The sub-agent has access to Playwright MCP tools and Bash.

**Critical:** The sub-agent prompt must include ALL of the following. Do not assume it knows anything — it starts with zero context:

```
You are a browser test agent. Your ONLY job is to drive a browser and verify features.

## Your mission
<paste the numbered verification steps here>

## Data seeding
Before verifying, create the minimal data the feature needs. Follow the checklist below.
Prefer seeding through the UI; use API/SDK only when the checklist explicitly calls for it:
<paste the seeding checklist from Step 2 here — e.g.:>
- Navigate to Suites → click "Create Suite" → fill name "Test Suite" → save
- Open the suite → add a scenario → run it once
- Wait for the run to complete before proceeding to verification

Only create what is listed above. Do not add extra data beyond what is needed.

## Connection
- App URL: http://localhost:<port>
- Browser: Chromium (headless) — use Playwright MCP tools
- Save screenshots to: <absolute artifact path>/screenshots/

## Auth (NextAuth credentials form, NOT Auth0)
- Navigate to the app → redirects to /auth/signin (Email + Password form)
- Email: browser-test@langwatch.ai
- Password: BrowserTest123!
- If "Register new account" needed, register first with same credentials
- Org name if onboarding: Browser Test Org
- After auth: dashboard shows "Hello, Browser" + "Browser Test Org" header

## How to interact
- Use browser_snapshot (accessibility tree) for finding elements — it's faster than screenshots
- Use browser_take_screenshot to capture evidence at each key step
- Use browser_wait_for with generous timeouts (60-120s for first page loads, dev mode is slow)
- Number screenshots sequentially: 01-sign-in.png, 02-dashboard.png, etc.

## Guardrails — READ THESE
- You have a maximum of 40 tool calls (seeding + verification). If you haven't finished, report what you verified and what's left.
- Do NOT debug app issues. If something doesn't work, screenshot it, mark it FAIL, and move on.
- Do NOT modify any files, fix any code, or investigate root causes.
- Do NOT go off-script. Only verify the steps listed above.
- If a step fails, take a screenshot, record FAIL, and continue to the next step.
- When done, return a markdown summary table: | # | Step | Result | Screenshot |
```

## Step 4: Collect results

When the sub-agent returns:
1. Parse its summary table
2. Write the report to `browser-tests/<feature-name>/<YYYY-MM-DD>/report.md`:

```markdown
# Browser Test: <feature-name>
**Date:** YYYY-MM-DD
**App:** http://localhost:<port>
**Browser:** Chromium (headless)
**Branch:** <current branch>
**PR:** #<number> (if known)

## Results

| # | Scenario | Result | Screenshot |
|---|----------|--------|------------|
| 1 | <name>   | PASS   | screenshots/01-xxx.png |

## Failures (if any)
- **Scenario 2:** Expected X but saw Y.

## Notes
<any observations>
```

3. If you started the app (no `.dev-port` existed before), tear it down: `scripts/dev-down.sh`

## Step 5: Upload screenshots and update the PR

Screenshots are uploaded to **img402.dev** (free, no auth) instead of committed to git. This avoids binary bloat in the repo.

1. **Upload each screenshot** to img402.dev:
   ```bash
   curl -s -F "image=@browser-tests/<feature>/<date>/screenshots/01-xxx.jpeg" https://img402.dev/api/free
   # Returns: {"url":"https://i.img402.dev/abc123.jpg", ...}
   ```
   Collect the returned URLs for each screenshot.

2. **Update the PR description** with the results table using img402 URLs so images render inline:

   Read the current PR body first (`gh pr view --json body`), then append a new section:
   ```markdown
   ## Browser Test: <feature-name>

   | # | Scenario | Result | Screenshot |
   |---|----------|--------|------------|
   | 1 | <name> | PASS | ![01](https://i.img402.dev/abc123.jpg) |
   ```

   Use `gh api repos/langwatch/langwatch/pulls/<number> -X PATCH -f body="..."` to update (not `gh pr edit`).

3. **Do NOT commit `browser-tests/`** — it is gitignored. Screenshots are ephemeral local artifacts; the img402 URLs in the PR body are the permanent record.

## Step 6: Report

Return the summary to the user/orchestrator. Include:
- The results table
- Link to the PR where screenshots are now visible
- Note: img402.dev free tier has 7-day retention; screenshots expire but remain in the PR body as broken images after that

## Rules

- **You are the orchestrator, not the browser driver.** Spawn a sub-agent for all browser work.
- **Never ask the user for anything.** Ports, credentials, features, browser choice — all resolved automatically.
- **Read `HOW_TO.md`** in this skill directory before your first run — it has gotchas about Chakra UI, dev mode slowness, and known issues. Include relevant warnings in the sub-agent prompt.
- **One sub-agent per run.** If it fails or times out, report the failure — don't retry.
- **Don't create test files.** This is interactive verification only.
