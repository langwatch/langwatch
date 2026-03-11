---
name: browser-test
description: "Validate a feature works by driving a real browser with Playwright MCP. No test files — just interactive verification."
user-invocable: true
argument-hint: "[port] [feature description or feature-file-path]"
---

# Browser Test — Interactive Feature Validation

You use the Playwright MCP tools to open a browser, navigate the app, and verify a feature works as expected. No test files, no framework — just drive the browser and report results.

## Input

Parse `$ARGUMENTS` for:
- **Port** (optional): the number (e.g. `5570`) or `:<port>` format
- **Feature** (optional): a description of what to verify, or a path to a `specs/*.feature` file

If a feature file path is given, read it and extract the scenarios. If a plain description is given, use it directly. If neither is provided, ask the user what to verify.

## Port Discovery & App Lifecycle

Resolve the port in this order — **do not ask the user for a port**:
1. Explicit port in `$ARGUMENTS` → use it
2. Read `.dev-port` file in the repo root → source it for `APP_PORT`
3. **No port and no `.dev-port`?** → run `scripts/dev-up.sh` to start an isolated dev instance, then read the `.dev-port` it creates

```bash
# .dev-port format (written by dev-up.sh):
APP_PORT=5560
BASE_URL=http://localhost:5560
COMPOSE_PROJECT_NAME=langwatch-abcd1234
```

If you started the app (step 3), you own the lifecycle — run `scripts/dev-down.sh` when the browser test is complete.

## Before You Start

Always use Chromium. Do not prompt for browser choice.

Skip all interactive prompts — resolve everything automatically. The only reason to ask the user anything is if you need credentials for auth and can't find them.

## Artifact Directory

All screenshots and reports are saved to a structured directory:

```
browser-tests/<feature-name>/<YYYY-MM-DD>/
  screenshots/
    01-sign-in-page.png
    02-dashboard.png
    ...
  report.md
```

**Deriving `<feature-name>`:**
- From feature file: use the filename without extension (e.g. `specs/features/plans-comparison.feature` → `plans-comparison`)
- From description: slugify to kebab-case (e.g. "Fix modal overflow" → `fix-modal-overflow`)
- From branch name as fallback: strip prefix (e.g. `issue123/fix-modal-overflow` → `fix-modal-overflow`)

Create the directory at the start of the run.

## Workflow

### 1. Navigate to the app

```text
browser_navigate → http://localhost:<port>
```

Take a snapshot to confirm the app is loaded.

### 2. Walk through each scenario

For each scenario or verification step:

1. **Snapshot** the page to see current state
2. **Interact** — click, type, select — using the MCP tools (`browser_click`, `browser_type`, `browser_select_option`, etc.)
3. **Verify** — snapshot again and check the expected outcome is visible
4. **Screenshot** each key step — save to `browser-tests/<feature-name>/<YYYY-MM-DD>/screenshots/`

Use `browser_wait_for` when you need to wait for async operations (toasts, loading states, API calls).

### 3. Save report

Write `browser-tests/<feature-name>/<YYYY-MM-DD>/report.md`:

```markdown
# Browser Test: <feature-name>
**Date:** YYYY-MM-DD
**App:** http://localhost:<port>
**Browser:** Chromium | Firefox
**Branch:** <current branch>
**PR:** #<number> (if known)

## Results

| # | Scenario | Result | Screenshot |
|---|----------|--------|------------|
| 1 | <name>   | PASS   | screenshots/01-xxx.png |
| 2 | <name>   | FAIL   | screenshots/02-xxx.png |

## Failures (if any)
- **Scenario 2:** Expected X but saw Y.

## Notes
<any observations, timing issues, flakiness>
```

### 4. Report to caller

Return the summary to the user or orchestrator. Include the artifact directory path and, if this will be used in a PR, note that screenshots can be linked using:

```
https://raw.githubusercontent.com/OWNER/REPO/BRANCH/browser-tests/<feature-name>/<date>/screenshots/<file>.png
```

## Rules

- Read `HOW_TO.md` in this skill directory before your first run — it has critical gotchas about auth, port mismatches, Chakra UI, and dev mode slowness
- Use `browser_snapshot` (accessibility tree) for interactions, not screenshots — it's faster and gives you element refs
- Use `browser_take_screenshot` to capture each key verification step and failures
- Don't create any test files — this is interactive verification only
- If the app isn't running and `.dev-port` doesn't exist, run `scripts/dev-up.sh` to start one — don't ask, just do it
- If a page requires auth/login, walk through login first and ask the user for credentials if needed
