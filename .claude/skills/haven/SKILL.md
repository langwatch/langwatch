---
name: haven
description: "Daily use of thuishaven (`haven`), the dev-stack orchestrator: start, stop and inspect this worktree's stack, read logs, print the resolved env without leaking a secret, find the app and API URLs, and drive a stack as an agent. Use when someone says 'haven up', 'start the stack', 'is the stack up', 'haven logs', 'haven status', 'haven env', 'what is the app URL', 'app.<slug>.langwatch.localhost', 'haven up --agent -d', 'restart the api lane', 'reset the database', 'haven install --build', 'stack home', 'haven feedback', 'the haven orb', or 'try a PR locally'. When the stack will not come up, or the page is blank or the log is frozen, read troubleshooting.md beside this file."
user-invocable: true
argument-hint: "[up | status | logs <service> | env | down | restart <lane> | db ...]"
---

# haven, day to day

`haven` (thuishaven) gives each worktree its own stack at hostnames, not ports. The
reference is `tools/thuishaven/README.md`; the processes and flags are in
`dev/docs/LOCAL_STACK.md`. `haven help <command>` lists every flag a command takes,
`haven help env` the knobs, `haven help hosts` the hostname scheme. Read those before
guessing a flag.

Run it from the workspace root. `make haven <sub>` forwards to the CLI (`dev/haven.mk`);
`make haven install` puts plain `haven` on your PATH and installs what the machine
needs. With no TTY it runs `haven install --yes` (no prompts; on macOS also the
native tier: `brew install grafana prometheus loki` and the pinned ClickHouse,
Tempo and Alloy downloads). macOS needs no colima: the install list leaves the
runtime off and Langy runs on the host tier by default (`up` says it is unsandboxed).
haven starts the Colima VM only when a selected lane runs in a container (container ClickHouse or observability, sandboxed Langy, `haven play`). When it starts the VM it records that in its home (`colima-<profile>.json`), and `haven down` or the daemon stops it once no stack needs a container and none is running; `haven status` then adds "stopped by haven". A VM you started yourself is never stopped.
A failed non-required row is
logged and the run carries on. Re-running is a no-op;
`haven install --list --agent` reports without installing. `haven install --build` builds the
consoles the binary embeds in one cached, parallel `nx run-many` (the `haven-console` project tag
is the one list) behind a single progress line, then the binary; a console that fails to build
serves a page naming `make haven-web`. Logs go to the install log directory.

## As an agent

| Do                                          | Command                                         |
| ------------------------------------------- | ----------------------------------------------- |
| Start without a log view that never returns | `haven up --agent -d`                           |
| One-shot health of every stack              | `haven status --agent` (`--json` for a machine) |
| Read a service's log                        | `haven logs api --since 10m --agent`            |
| Only warnings and worse                     | `haven logs api --level warn --agent`           |
| Last distinct failures, grouped             | `haven errors --agent`                          |
| Recent root spans of this stack             | `haven traces --json`                           |
| One trace's span tree                       | `haven traces <trace-id> --json`                |
| Slow or failing traces                      | `haven traces --min-duration 500ms --errors`    |
| Full info/debug stream from Loki            | `haven logs api --loki --since 1h --grep boom`  |
| Logs for one trace                          | `haven logs --trace <trace-id>`                 |
| Raw query, this worktree only               | `haven query promql 'up' --agent`               |

- Bare `haven up` without a TTY never returns and dies with your shell. Always `-d`.
- `--agent` (or `HAVEN_AGENT=1`) makes output plain: no colour, no redraws.
- Never poll a slow boot in a loop. Start, then read `haven status` once, later.

## Where things are

```text
https://app.<slug>.langwatch.localhost        the UI
https://app.<slug>.langwatch.localhost/api    the API, same origin as the UI
https://api.<slug>.langwatch.localhost        the API directly, no Vite in front
https://gateway.<slug>...   nlp.<slug>...     the Go data plane
https://<slug>.langwatch.localhost            this worktree's home, up even when the stack is down
https://hub.langwatch.localhost               every stack on the machine
```

- `<slug>` is the worktree directory name, sanitised (`haven status` prints it).
- Use these hostnames, never a port read from `.env` or the overlay. A port in an
  `API_PORT` variable is the loopback port behind the proxy, not what a browser opens.
- The proxy may bind 1355 rather than 443; quote the port when it is not 443
  (`~/.portless/proxy.port`). Postgres has no hostname: `haven db url postgres`.
- The simulators answer at `<name>.<slug>.langwatch.localhost`: see the `sims` skill.

## Lanes and logs

`ui`, `api`, `go` (gateway and nlp), `sims`, `langy`. The api lane hosts the worker, so
`haven logs api` and `haven logs worker` each show half of it. Under
the default ui, api and worker are one `app` lane: see `dev-runtime`. The `go` lane
also hosts the simulators and no `sims` lane runs; `LANGWATCH_DEV_ONE_PROCESS=0` splits
both (`LANGWATCH_GO_ONE_PROCESS` is a deprecated alias). The Go lane rebuilds and swaps
its child on a Go change (`haven go-watch`); `LANGWATCH_GO_WATCH=0` or `haven up --watch=false`
turns that off; `haven logs <sim>` still reads each one. Langy stays its own lane.

```bash
haven logs api -t                 # follow one service
haven logs go --since 5m --level error
haven restart sims                # bounce one lane; nothing else restarts
haven restart api                 # restart the whole lane
haven up --watch=false -f         # hold the stack (sticky): no backend reload on a file change
haven reload [app|api|worker]     # apply changes to a held stack in place; waits for "reload finished"
haven up --ui=built -f            # testing without changing code (Haiku testers): production build served by the api, no Vite (sticky)
haven up --ui=bundled -f          # editing and testing visually: Vite 8 bundled dev, in-memory bundles, HMR kept (sticky)
haven up --ui=dev -f              # almost never: unbundled Vite, thousands of requests per page
haven reload ui                   # --ui=built: rebuild the bundle and swap it in; returns once swapped
```

What `--ui=built` changes, measured on /governance with a signed-in headless page, dev vs built:

| | dev | built |
|---|---|---|
| Role | almost never | testing without changing code |
| Page memory | 708 MB | 396 MB |
| JS heap | 242 MB | 69 MB |
| Requests | 2289 | 563 |

- The app's own process sheds the UI's Vite server too.
- There is no orb (so no `haven feedback`) and no HMR, and the app runs its production code paths.
- Old assets pile up in `apps/ui/dist/client/assets`; `rm -rf apps/ui/dist` clears them.
- A build peaks at about 4.8 GB.

## The stack's own traces and logs

This is the stack's OTel telemetry (Tempo, Loki), not product traces. Every read is
filtered to this worktree and prints a Grafana deep link (a `grafana` field in `--json`).

```bash
haven traces --service api --name checkout --since 1h   # filters; also --min-duration, --errors
haven traces <trace-id> --json                          # span tree plus the link
haven logs api --loki --level info --grep timeout       # Loki: what the muted consoles never printed
haven logs --trace <trace-id>                           # Loki lines carrying that trace_id
```

`--loki` and `--trace` need the observability stack (`haven up`); services match as
substrings of the OTel service name. `--grep` also filters the plain captured read.
`--trace` finds only lines whose structured metadata carries `trace_id`; when none do,
it is empty, so fall back to `--since` around the trace's start time.

When the flags cannot ask it, `haven query traceql|logql|promql '<query>'` sends a raw
query (`--since` default 1h, `--limit` default 100, `--stack <slug>`, `--json`/`--agent`
returns `{query, grafana, data}` with the backend's own answer). Every selector gets this
worktree's filter forced in before sending, so results never mix stacks; the scoped
query is echoed in `query`.

```bash
haven query traceql '{ status = error && duration > 1s }'
haven query logql 'sum by (service_name) (count_over_time({service_name=~".+"} |= "timeout" [5m]))'
haven query promql 'rate(http_server_request_duration_count[5m])' --since 30m
```

Only `haven down` followed by `haven up` reloads a changed `.env`. `haven restart` does
not.

## The stack home

`https://<slug>.langwatch.localhost` (`apps/haven-web`) lists every surface with its status. A
surface that is not live says why (what it waits for and its lane's last warning), and its row has
Restart, or Start for a surface that was not selected. An api the stack refuses to serve because
the database is below the LTS floor shows a database reset button. `haven db reset` migrates and
seeds exactly the databases it dropped, also for a stack the hub does not know yet. The daemon
trusts a pid only together with its process start time, holds its claim as a flock for its whole
life, and writes stack records atomically, so a recycled pid or a second daemon cannot be mistaken
for ours (`tools/thuishaven/app/identity.go`).

## The env, without leaking it

- `haven env` prints this stack's resolved environment with every secret masked
  (`<secret:masked>`, connection strings keep their shape). Safe to paste into an issue.
- `eval "$(haven env --reveal)"` loads the real values into your shell. Never paste
  that output, never print it, never read `.env` to find a value.
- Which keys are secret: every `Secret.load("ID")` handle found in source, plus any
  name that looks like a credential (`tools/thuishaven/domain/secretkeys.go`).
- The workspace `.env` beats haven's overlay. A value you set there wins; haven fills only
  what is unset.
- Stack credentials are made up by haven, per stack: `NEXTAUTH_SECRET`, `CREDENTIALS_SECRET`,
  `LANGWATCH_INSTANCE_ADMIN_API_KEY`, `HAVEN_SEED_SCIM_TOKEN`. They live in haven's own state, survive
  down/up and rotate only on `haven destroy`. No real key, no 1Password.
- Stripe is paymentsim on every stack unless `.env` sets a Stripe key; then that key is used.
  `haven up` prints `Stripe: paymentsim` or `Stripe: your key from .env` (`paymentsim` skill).
- `haven seed` ends with the admin login, the org, team and project slugs, the project API key, the
  personal access token, the SCIM token and the instance admin key: masked, `--reveal` shows them,
  `--json` gives one object.

## A signed-in browser for a lane

Never type or read a password: haven signs in for you. `haven browser` drives one shared
headless shell per stack (Playwright, `apps/haven-web/scripts/browser-daemon.ts`), one
context and one session per `--lane`, started on first use and stopped once no lane is
left (idle lanes close after 5 minutes).

```bash
haven browser open /settings --lane qa-1 --as admin        # url + title once the app shell mounted
haven browser snapshot --lane qa-1 --as admin              # accessibility snapshot with element refs (e12), as text
haven browser screenshot --lane qa-1 --as admin --out .claude/tmp/qa-1.png
haven browser click e12 --lane qa-1 --as admin             # a ref from the last snapshot
haven browser fill e14 "t1 name" --lane qa-1 --as admin    # also: select <ref> <option>, type <text>, press <key>, goto <url>
haven browser eval "document.title" --lane qa-1 --as admin
haven browser open /settings --lane qa-1 --as admin --wait-for 'text=Members'
haven browser select e12 "Team" --lane qa-1 --as admin   # native <select> or combobox: opens it, picks the option by its text; target is a snapshot ref or CSS selector
haven browser close --lane qa-1                            # status | stop for the whole browser
haven auth admin --out state.json                          # just the Playwright storage state (mode 600)
```

- `--as` is `admin` or a seeded login's email (`haven seed --json` lists them); omit it to stay signed out.
- A lane that lands on sign-in is signed back in and returned to its page; a backend reload is waited out on its ready line.
- Commands wait on page events (shell mounted, network idle, `--wait-for`), never sleeps; `--timeout` bounds them (default 30s).
- The stack allows 30 sign-ins per 15 minutes; a lane reuses its saved session, so keep lane names stable.
- Use one plain `haven browser` command per shell call. Multi-line commands, or a command chained into `grep` or `sed`, get refused by the agent safety check. A refused command is not rephrased: mark the step blocked and move on.
- Never write a key, token or password to a file, even scratch. The safety check refuses it as credential materialisation. Let haven hold the credential.
- One shared browser costs about 230 MB, plus about 0.7 GB per signed-in dev page (about 0.4 GB with `--ui=built`). Close your lane when done.

## Other commands you will want

| Need                                       | Command                                             |
| ------------------------------------------ | --------------------------------------------------- |
| Stop this stack, keep databases            | `haven down`                                        |
| Everything off, daemon and proxy too       | `haven down --all`                                  |
| Drop a stack's databases                   | `haven destroy <slug>` (needs `--yes` as an agent)  |
| Reset or reseed this stack's data          | `haven db reset [preset]`, `haven db seed [preset]` |
| Add or drop a service, sticky              | `haven up +langy`, `haven up -mail`                 |
| Evaluators (monitors, evaluations)         | `haven up +langevals`                               |
| Zero-cost model answers                    | `haven up +llm`                                     |
| Logins and stack credentials               | `haven seed --json --reveal`, `haven env --reveal`  |
| Try a PR in its own worktree               | `haven pr <number>`                                 |
| Run a heavy command under the machine slot | `haven run`, `haven slot run -- <cmd>`              |

Seed presets are in `haven help db` (`demo`, `onboarding`, `post-onboarding` and more).

## Feedback from the app page (the haven orb)

When haven runs the stack, the app page carries the haven orb, bottom right
(`apps/ui/vite/haven-orb/`, `specs/setup/haven-dev-orb.feature`). A reader picks an
element or drags a region, types a note, and it lands in this stack's store. The orb also
pushes the page's last 200 console messages and requests: method, URL without its query,
status, duration. Never a body, a header or a cookie.

While building UI, read it before you call the work done:

```bash
haven feedback list --open --agent      # notes nobody resolved yet
haven feedback show <id> --agent        # one note: selector or region, viewport, console, requests
haven feedback resolve <id>             # once you fixed it
haven feedback wait --timeout 5m        # block until the reader sends the next note
haven page console --level error --agent
haven page network --failed --agent
```

The page buffer is whichever tab pushed last, and is empty until someone opens the app with
the orb showing. The files live in `.haven/logs/<slug>/orb/`; `--stack <slug>` reads another
worktree's.

## When it will not come up

`troubleshooting.md` (same folder) covers: a stack that is already up, the portless
proxy dying or holding root-owned state, `.localhost` not resolving on WSL2, Langy
needing its `langy-worker` binary on the host, stale k8s URLs in `.env`, a frozen log, a blank page
that is only Vite re-optimising, and signing in for a browser check.

## Do not

- Run `haven up` or `haven down` on a checkout another session is using without asking. As an agent, a `haven up -f` or `make haven install` on a stack that testers are driving is refused by the safety check: hand the command to the user.
- Search the repo with `git grep`, never `rg -uu` from the root: it walks `node_modules` and `.worktrees` at about 3 cores for minutes.
- Name an app port in a URL you report. Name the hostname.
- Call a stack healthy because `haven up` returned. Check `haven status`, then the URL.
