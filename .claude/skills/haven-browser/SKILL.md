---
name: haven-browser
description: "Drive a signed-in headless browser against this worktree's stack with `haven browser`: lanes, --as, snapshots, clicks, forms, screenshots, record and replay, with no password handled by the agent. Use when someone says 'haven browser', 'drive the UI', 'open the app in a browser', 'sign in as admin in the browser', 'snapshot the page', 'screenshot the app', 'browser lane', 'record a flow', 'replay a flow', 'turn a walk into an e2e test', or 'should I use Playwright'. Passkeys, security keys and TOTP codes are mfasim."
user-invocable: true
argument-hint: "[open <url> | snapshot | click <ref> | screenshot | record start|stop | close] --lane <name> --as admin"
---

# haven browser

`haven browser` drives one headless Chromium for the whole machine (Playwright, daemon at
`apps/haven-web/scripts/browser-daemon.ts`), with one context and one session per stack and
`--lane`: every agent on every stack shares it, and lanes never share a context. It starts on
first use and exits once no lane is left. A worktree whose daemon script is older keeps its own. It needs a running stack
(`haven up --agent -d`, see `haven-lifecycle`).

**Use `haven browser`, not Playwright, and never an MCP browser tool.** It is the one way to drive a browser here. It signs in for you, waits on page events, re-signs a
lane that lands on sign-in, and answers an action with what changed. Where haven is installed
its gate refuses Playwright's MCP tools, `playwright-cli` and `playwright open|codegen|show-trace`;
e2e runs (`playwright test`, `pnpm test:e2e`) are untouched.

**Actions answer with a diff.** `open`, `goto`, `click`, `hover`, `drag`, `upload`, `fill`,
`select`, `type` and `press` print the url and title, then the accessibility-tree changes
(`+` added, `-` removed, `~` changed, refs included, 40 lines at most), the requests the action
made and any console errors. Take a `snapshot` only when the diff is not enough; `--full`
prints url and title alone.

## Verbs

```bash
haven browser open /settings --lane qa-1 --as admin        # url + title once the app shell mounted
haven browser goto /traces --lane qa-1 --as admin
haven browser snapshot --lane qa-1 --as admin              # accessibility tree with refs (e12), as text
haven browser snapshot --grep Save --lane qa-1 --as admin  # only nodes whose role or name contain "Save", plus ancestors
haven browser snapshot --depth 3 --max-chars 4000 --lane qa-1 --as admin  # first 3 levels; cut with a "truncated" footer
haven browser click e12 --lane qa-1 --as admin             # a ref from the last snapshot (or a CSS selector)
haven browser click e12 --download-to .claude/tmp/out/report.csv --lane qa-1 --as admin  # waits for the download the click starts, saves it, prints {"file","name","size","mediaType"}
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
haven browser route add '**/api/trpc/**' --status 503 --times 1 --lane qa-1  # fault matching requests (Playwright context route)
haven browser route list --lane qa-1                       # rules with their hit counts
haven browser route off --lane qa-1                        # lift every rule (or name one glob)
haven browser state-load state.json --lane qa-1            # load a Playwright storage state (see haven-auth)
haven browser network --lane qa-1 [--since-last] [--grep trpc] [--failed] [--all]  # "#12 GET /api/x 200 34ms" per request
haven browser network show 12 --lane qa-1                  # that request's bodies, secret fields <redacted>, clipped
haven browser console --lane qa-1 [--since-last] [--level error]  # console messages and uncaught page errors
haven browser profile start --lane qa-1                    # CDP performance trace (one page at a time per machine)
haven browser profile stop --lane qa-1                     # long tasks, scripting/layout ms, slowest requests; trace file under .claude/tmp/haven-browser/
haven browser lean on --lane qa-1                          # block images, fonts, media; animations off (or --lean on any verb)
haven browser lean off --lane qa-1                         # before a screenshot that needs images and fonts
haven browser close --lane qa-1                            # this lane only
haven browser status                                       # pid, this stack's lanes, every lane
haven browser stop                                         # this stack's lanes (others keep theirs)
haven browser stop --all                                   # every lane on the machine and the daemon: only when you own them all
```

Passkeys, security keys and TOTP codes: `haven browser mfa add|list|remove|uv|totp` on the same
`--lane`, taught by the `mfasim` skill.

## Flags

| Flag                  | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `--lane <name>`       | your own context; lanes never share one. Keep names stable                |
| `--as <admin\|email>` | sign the lane in as this login; omit it to stay signed out                |
| `--stack <slug>`      | another worktree's stack                                                  |
| `--wait-for <sel>`    | also wait for a CSS or `text=` selector, e.g. `--wait-for 'text=Members'` |
| `--timeout <dur>`     | bound on page waits (default 30s)                                         |
| `--status <code>`     | route add: the status matching requests answer (default 503)              |
| `--times <n>`         | route add: fault only the next n matches, then let requests through       |
| `--out <file>`        | screenshot PNG, or the script `record stop` or `record save` writes       |
| `--full`              | actions: url and title only, no diff                                      |
| `--lean`              | turn lean on for the lane (sticky until `lean off`)                       |
| `--since-last`        | network, console: only what arrived since this lane's last read           |
| `--failed`            | network: failed requests and 4xx/5xx only                                 |
| `--level <level>`     | console: debug, info, warning or error and above                          |
| `--all`               | network: include scripts, styles, images, fonts; stop: the whole browser  |
| `--json`              | machine-readable reply                                                    |

`--as` is `admin` or a seeded login's email (`haven db seed --json` lists them).

## Limits

- The machine's browser holds 24 lanes across every stack. A lane idle for 10 minutes is closed; its next command says
  `lane X was closed after idling; reopen with open`, and `open` brings it back.
- After 2 minutes idle a lane's page is unloaded (cookies, storage, routes and lean kept)
  and reopened at the same url by its next command, in about 3 s. Refs from before are
  gone: take a snapshot. Form input and anything not in the url is lost.
- Memory has one limit, browser-memory-mb (an eighth of RAM, 2-8 GiB; `haven machine limits`). Above 3/4
  of it idle pages unload, oldest first; above it new lanes are refused; haven kills the browser only above
  the limit plus a quarter (at least 1 GiB). `haven browser status` shows all three.
- One shared browser costs about 0.5 GB, plus about 0.4 GB per signed-in page in use
  (traces table) and almost nothing per idle lane. Close your lane when done.
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
haven browser record save --lane qa-1 --out flow.json       # any walk so far, no start needed
haven browser record start --lane qa-1 --as admin           # or mark a start, then drive the lane
haven browser record stop --lane qa-1 --out flow.json       # JSON script from the start; prints its path
haven browser replay flow.json --lane qa-1 --as admin [--json]  # exits non-zero at the first divergence
haven browser record export flow.json --playwright flow.spec.ts  # a test for dev/tests/agentic-e2e
```

- Every lane keeps its last 200 actions, so a walk can be saved after the fact; a replay
  is not added to it. A step whose element was gone is left out (the action reported it).
- Steps hold stable locators (role and name, label, test id, text), the path after each step
  and the app queries it caused (tRPC procedure names, method, status). Never bodies, headers
  or secrets; password values are `<redacted>` and a replay stops there until you edit them.
- A replay needs each recorded query back with its status and each step at its recorded
  path; it reports the first step that differs.

See also: `haven-auth` (storage state), `haven-seed` (the logins), `haven-orb` (feedback from a person's own page), `browser-test` (a scenario walk with a pass/fail report), `browser-pair` (live feedback with a person watching).
