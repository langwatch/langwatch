---
name: haven-browser
description: "Drive a signed-in headless browser against this worktree's stack with `haven browser`: lanes, --as, snapshots, clicks, forms, screenshots, record and replay, with no password handled by the agent. Use when someone says 'haven browser', 'drive the UI', 'open the app in a browser', 'sign in as admin in the browser', 'snapshot the page', 'screenshot the app', 'browser lane', 'record a flow', 'replay a flow', 'turn a walk into an e2e test', or 'should I use Playwright'. Passkeys and security keys are webauthnsim."
user-invocable: true
argument-hint: "[open <url> | snapshot | click <ref> | screenshot | record start|stop | close] --lane <name> --as admin"
---

# haven browser

`haven browser` drives one shared headless Chromium per stack (Playwright, daemon at
`apps/haven-web/scripts/browser-daemon.ts`), with one context and one session per `--lane`.
It starts on first use and stops once no lane is left. It needs a running stack
(`haven up --agent -d`, see `haven-lifecycle`).

**Prefer `haven browser` over raw Playwright.** It signs in for you, waits on page events and
re-signs a lane that lands on sign-in. Use Playwright directly only for a target haven
cannot reach (a page outside the stack).

## Verbs

```bash
haven browser open /settings --lane qa-1 --as admin        # url + title once the app shell mounted
haven browser goto /traces --lane qa-1 --as admin
haven browser snapshot --lane qa-1 --as admin              # accessibility tree with refs (e12), as text
haven browser snapshot --grep Save --lane qa-1 --as admin  # only nodes whose role or name contain "Save", plus ancestors
haven browser snapshot --depth 3 --max-chars 4000 --lane qa-1 --as admin  # first 3 levels; cut with a "truncated" footer
haven browser click e12 --lane qa-1 --as admin             # a ref from the last snapshot (or a CSS selector)
haven browser hover e12 --lane qa-1 --as admin             # menus, hover cards, toast stacks
haven browser drag e12 e30 --lane qa-1 --as admin          # real mouse moves, centre to centre
haven browser drag e12 --by 120,-40 --lane qa-1 --as admin # or by dx,dy pixels (a node on a canvas)
haven browser upload e9 .claude/tmp/a.csv --lane qa-1 --as admin  # files must sit under the repo's .claude/tmp/
haven browser fill e14 "t1 name" --lane qa-1 --as admin
haven browser select e12 "Team" --lane qa-1 --as admin     # native select or combobox, picked by its text
haven browser type "hello" --lane qa-1 --as admin          # into the focused element
haven browser press Enter --lane qa-1 --as admin
haven browser screenshot --lane qa-1 --as admin --out .claude/tmp/qa-1.png
haven browser eval "document.title" --lane qa-1 --as admin
haven browser state-load state.json --lane qa-1            # load a Playwright storage state (see haven-auth)
haven browser close --lane qa-1                            # this lane only
haven browser status                                       # the whole browser
haven browser stop                                         # every lane and the daemon
```

Passkeys and security keys: `haven browser authenticator add|list|remove|uv` (`--kind`,
`--uv`, `--resident`), taught by the `webauthnsim` skill.

## Flags

| Flag                  | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `--lane <name>`       | your own context; lanes never share one. Keep names stable                |
| `--as <admin\|email>` | sign the lane in as this login; omit it to stay signed out                |
| `--stack <slug>`      | another worktree's stack                                                  |
| `--wait-for <sel>`    | also wait for a CSS or `text=` selector, e.g. `--wait-for 'text=Members'` |
| `--timeout <dur>`     | bound on page waits (default 30s)                                         |
| `--out <file>`        | screenshot PNG, or the script `record stop` writes                        |
| `--json`              | machine-readable reply                                                    |

`--as` is `admin` or a seeded login's email (`haven seed --json` lists them).

## Limits

- A browser holds 16 lanes. A lane idle for 10 minutes is closed; its next command says
  `lane X was closed after idling; reopen with open`, and `open` brings it back.
- A new lane is refused (not crashed) when the browser's memory passes 3 GB.
- One shared browser costs about 230 MB, plus about 0.7 GB per signed-in dev page (about
  0.4 GB with `--ui=built`). Close your lane when done.
- The stack allows 30 sign-ins per 15 minutes; a lane reuses its saved session.
- Commands wait on page events (shell mounted, network idle, `--wait-for`), never sleeps.
  A backend reload is waited out on its ready line.
- A traces-table snapshot is about 50 KB: prefer `snapshot --grep <text>` with `--depth` or `--max-chars`.

## Agent safety

- One plain `haven browser` command per shell call. Multi-line commands, or a command chained
  into `grep` or `sed`, are refused by the agent safety check. A refused command is not
  rephrased: mark the step blocked and move on.
- Never type, read or print a password. Never write a key, token or password to a file, even
  scratch; the check refuses it as credential materialisation. Let haven hold the credential.

## Record and replay

Build e2e tests from a manual walk:

```bash
haven browser record start --lane qa-1 --as admin           # then drive the lane as usual
haven browser record stop --lane qa-1 --out flow.json       # JSON script; prints its path
haven browser replay flow.json --lane qa-1 --as admin [--json]  # exits non-zero at the first divergence
haven browser record export flow.json --playwright flow.spec.ts  # a test for dev/tests/agentic-e2e
```

- Steps hold stable locators (role and name, label, test id, text), the path after each step
  and the app queries it caused (tRPC procedure names, method, status). Never bodies, headers
  or secrets; password values are `<redacted>` and a replay stops there until you edit them.
- A replay needs each recorded query back with its status and each step at its recorded
  path; it reports the first step that differs.

See also: `haven-auth` (storage state), `haven-seed` (the logins), `haven-orb` (feedback from a person's own page).
