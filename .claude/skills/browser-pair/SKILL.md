---
name: browser-pair
description: "Iterate on UI with a person watching and giving live visual feedback. Pointer skill: the person uses their own tab on the stack and the haven orb; you read their notes and check fixes with `haven browser`. Use when the user says 'browser pair', 'paired browser', 'let's look at this together', 'open chromium', or wants live visual feedback on a UI change."
user-invocable: true
argument-hint: "[page-or-feature]"
---

# Browser pair: a person and you on one stack

There is no separate headed browser. Where haven is installed its gate refuses Playwright's MCP
tools, and `haven browser` is headless. The person looks at their own tab; you work from their
notes. `haven-browser` is the one authority for driving a browser.

1. **Stack.** `haven status` gives the app URL. If none runs, `haven up --agent -d` only when asked
   (`haven-lifecycle`). Tell the person the URL, and the mode: the default stack serves the built
   UI (an edit shows after a rebuild), `pnpm dev:hmr` serves Vite (an edit shows on save).
2. **Their feedback.** The haven orb on the page lets them point at an element or drag a region and
   leave a note. Read it with `haven orb feedback list --open --agent`, or block on
   `haven orb feedback wait` (`haven-orb`). Resolve a note once fixed.
3. **Your look.** Check a fix with `haven browser open <path> --lane pair --as admin`
   (`haven-auth` for sign-in). Use `snapshot --grep` to find controls and a `screenshot` when the
   change is visual (width, padding, colour, clipping, dark mode); a snapshot cannot show paint.
4. **Edits.** Read the component, make the smallest edit, say in one line what to look for, then
   tell them when the rebuild or save has landed. Components come from the design system
   (`design-system` skill); do not reach for raw Chakra.

Keep reports to a sentence or two: the person can see the page. Wait for their direction between
changes.

For a walk through scenarios with a pass/fail report, use `browser-test`.
