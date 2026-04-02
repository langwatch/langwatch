---
name: browser-pair
description: "Collaborative headed browser session for UI work. Launch Playwright Chromium visible to the user, handle auth, then interactively drive the browser while the user watches and gives real-time visual feedback. Edit code and refresh to verify fixes live. Use when the user says 'browser pair', 'paired browser', 'let's look at this together', 'open chromium', or wants to iterate on UI with live visual feedback."
user-invocable: true
argument-hint: "[url-or-port] [page-or-feature]"
---

# Browser Pair — Collaborative UI Session

Open a headed Chromium browser the user can see, then drive it interactively. The user watches, gives visual feedback, you make code changes and verify live. This is pair programming for UI.

**Key difference from `/browser-test`:** This is interactive and headed. You wait for user direction between actions. You edit code when they spot issues, then refresh to verify.

## Setup

Parse `$ARGUMENTS` for:
- **URL or port** (optional): full URL or just a port number (e.g. `5560` becomes `http://localhost:5560`)
- **Page** (optional): where to navigate after login (e.g. "agents page", "run plans")

If not provided, check for `.dev-port` file or ask the user.

## Tools

Use **only** `mcp__playwright-headed__*` tools. Never use `mcp__playwright__*` (headless). The user must see the browser.

Key tools:
- `mcp__playwright-headed__browser_navigate` — go to a URL
- `mcp__playwright-headed__browser_snapshot` — read page state (preferred over screenshots)
- `mcp__playwright-headed__browser_click` — click elements by ref
- `mcp__playwright-headed__browser_type` — type into inputs by ref
- `mcp__playwright-headed__browser_take_screenshot` — only when user asks to capture something

## Workflow

### Step 0: Track Progress

Before starting, create a task for each step below using TaskCreate. Chain sequential steps with addBlockedBy. As you work, update each task's status to `in_progress` when starting it and `completed` when done.

### 1. Launch and authenticate

Navigate to the app URL. Take a snapshot to see the page state.

If you land on a login/signup page:
1. Check `scripts/verify-browser-test.js` in the project for test credentials
2. Register or sign in with those credentials
3. Complete any onboarding flow (pick quick defaults)
4. Navigate to the main app

### 2. Navigate to the requested page

If the user specified a page, navigate there. Otherwise, take a snapshot and tell the user where you are.

### 3. Interactive loop

This is the core. Repeat:

1. **Snapshot** the current page
2. **Report** what's visible in 1-2 sentences — don't dump the full tree
3. **Wait** for the user's direction

When the user gives feedback:
- **Navigation:** "go to X" — navigate and snapshot
- **UI issue:** "the fonts don't match" — read the relevant component code, edit it, tell the user to refresh (or navigate away and back)
- **Interaction:** "click the button" — click it and snapshot the result
- **Verification:** "does it look right now?" — snapshot and describe

### 4. Code changes

When editing code based on visual feedback:
1. Read the component file first
2. Make the edit
3. Tell the user the change is saved — Next.js hot reload should pick it up
4. Navigate or refresh to verify: `mcp__playwright-headed__browser_navigate` to the same URL

### Final Check

Run TaskList. If any task is not `completed`, go back and finish it now.

## Rules

- Always use `browser_snapshot` for state awareness, not screenshots
- Keep reports concise — the user can see the browser, they don't need a full description
- Don't take autonomous actions — wait for the user between steps
- When making code edits, describe the change briefly so the user knows what to look for
- If the app isn't running, tell the user and suggest `make dev` or the relevant start command
