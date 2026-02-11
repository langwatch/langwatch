---
name: browser-test
description: "Validate a feature works by driving a real browser with Playwright MCP. No test files — just interactive verification."
user-invocable: true
argument-hint: "<port> [feature description or feature-file-path]"
---

# Browser Test — Interactive Feature Validation

You use the Playwright MCP tools to open a browser, navigate the app, and verify a feature works as expected. No test files, no framework — just drive the browser and report results.

## Input

Parse `$ARGUMENTS` for:
- **Port** (required): the number (e.g. `5570`) or `:<port>` format
- **Feature** (optional): a description of what to verify, or a path to a `specs/*.feature` file

If a feature file path is given, read it and extract the scenarios. If a plain description is given, use it directly. If neither is provided, ask the user what to verify.

## Before You Start

Ask the user:

1. **Which browser?** Chrome (Chromium) or Firefox
2. Confirm the port if not provided in arguments

Then check that the Playwright MCP `.mcp.json` matches the requested browser. The current config is:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

To use Firefox, `args` needs `"--browser", "firefox"`. If it doesn't match, tell the user to update `.mcp.json` and restart Claude Code, then re-run this skill.

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
4. **Screenshot** on failure for evidence

Use `browser_wait_for` when you need to wait for async operations (toasts, loading states, API calls).

### 3. Report results

After walking through all scenarios, report a summary:

```text
## Browser Test Results

**App:** http://localhost:<port>
**Browser:** Chromium | Firefox
**Feature:** <what was tested>

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | <name>   | PASS   |       |
| 2 | <name>   | FAIL   | <what went wrong> |

### Failures (if any)
- **Scenario 2:** Expected X but saw Y. Screenshot: <path>
```

## Rules

- Read `HOW_TO.md` in this skill directory before your first run — it has critical gotchas about auth, port mismatches, Chakra UI, and dev mode slowness
- Use `browser_snapshot` (accessibility tree) for interactions, not screenshots — it's faster and gives you element refs
- Use `browser_take_screenshot` only to capture evidence of failures. Always save to `.browser-test-screenshots/` directory (e.g. `filename: ".browser-test-screenshots/my-screenshot.png"`). This directory is gitignored.
- Don't create any test files — this is interactive verification only
- If the app isn't running, tell the user and stop
- If a page requires auth/login, walk through login first and ask the user for credentials if needed
- After completing a run, save notes to `history/YYYY-MM-DD-<feature>.md` using the template in `history/_TEMPLATE.md`
