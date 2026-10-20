---
name: browser-test
description: "Check that a feature works by walking its scenarios in a real browser and writing a pass/fail report with evidence. A recipe over `haven browser`: no test files, no browser commands of its own. Use when someone says 'browser test', 'verify this in the browser', 'walk the scenarios', 'check the feature live', or hands you a specs/*.feature file to confirm on a running stack."
user-invocable: true
argument-hint: "[feature description or feature-file-path]"
---

# Browser test: walk the scenarios, report the evidence

This skill is the recipe from "scenarios" to "report". It does not drive the browser itself.
**`haven browser` is the one way to drive a browser** (see `haven-browser`; sign-in is `--as admin`,
see `haven-auth`; seeded logins are `haven-seed`). Playwright's MCP tools and `playwright-cli` are
refused where haven is installed, and MCP browser tools are never used by lanes. Use plain
Playwright only for something haven cannot reach, and say so in the report.

## 1. Prepare

- A feature file path: read it and turn each scenario into a numbered step with an expected
  result. A plain description: use it as the one step list. Neither: smoke test (app loads,
  admin sign-in works, the dashboard renders).
- Stack: `haven status`. If none runs, start one only when asked (`haven-lifecycle`), and say if you
  did. The base URL is whatever `haven status` prints; use that one origin for the whole run. A
  different hostname for the same app (`127.0.0.1`, say) fails sign-in with a 403.
- A plain `pnpm dev` stack serves the built UI; `pnpm dev:hmr` serves Vite. First loads can take
  tens of seconds under Vite.
- Workspace: `browser-tests/<feature>/<YYYY-MM-DD>/` (gitignored; never commit it).

## 2. Seed only what the steps need

Decide which data must exist (a suite with one scenario, one trace, a completed run). Create it
through the UI where practical; use the API or a seed (`haven db seed`, `haven-seed`) for bulk
data. Keep it minimal. Credentials for ingestion come from a seeded login or a personal scoped
key, never a project key read from settings, and never pasted into a prompt or a report.

## 3. Walk it

Use one lane per run (`--lane bt-<feature> --as admin`). For each step: act, check the expected
result in the diff or a `snapshot --grep`, and record PASS or FAIL.

- Take a screenshot for each step that checks how something looks (drawer width, card padding,
  colour, clipping, dark mode) and for every failure. A snapshot finds controls; it cannot show
  paint. Save with `--out browser-tests/<feature>/<date>/NN-name.png`.
- On a failure: screenshot, `haven browser console --level error`, `haven browser network --failed`,
  mark it FAIL and go on. Do not debug the app or edit code during the walk.
- Overlays are a routed singleton with a back stack: assert that one overlay is open, that back
  returns to the caller and that a draft survives. Two stacked copies of the same drawer is a
  defect to report, not a quirk to press Escape past.
- Waits are `--wait-for 'text=...'`, never sleeps. Close the lane when done.

## 4. Report

Write `browser-tests/<feature>/<date>/report.md`:

```markdown
# Browser test: <feature>

**Date / stack URL / branch / PR (if known)**

| #   | Scenario | Result | Evidence    |
| --- | -------- | ------ | ----------- |
| 1   | <name>   | PASS   | 01-name.png |

## Failures

- **2:** expected X, saw Y (console and network lines).
```

Return the table to the caller. Publishing is a separate act, done only when asked: upload
screenshots with `gh issue comment --attach file#alt` (see the repository's PR rules) and put
the table in a PR comment, not the squash-merge body.

## Rules

- Never ask the user for a port, account or browser: resolve them as above.
- Read `HOW_TO.md` beside this file for gotchas before the first run.
- Do not create test files. To turn a walk into an e2e test use `haven browser record`
  (`haven-browser`), then `record export`.
- For a live session with a person watching, see `browser-pair`.
