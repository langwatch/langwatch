---
name: haven
description: "Daily use of thuishaven (`haven`), the dev-stack orchestrator: start, stop and inspect this worktree's stack, read logs, print the resolved env without leaking a secret, find the app and API URLs, and drive a stack as an agent. Use when someone says 'haven up', 'start the stack', 'is the stack up', 'haven logs', 'haven status', 'haven env', 'what is the app URL', 'app.<slug>.langwatch.localhost', 'haven up --agent -d', 'restart the api lane', 'reset the database', or 'try a PR locally'. When the stack will not come up, or the page is blank or the log is frozen, read troubleshooting.md beside this file."
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
`make haven install` puts plain `haven` on your PATH.

## As an agent

| Do | Command |
| --- | --- |
| Start without a log view that never returns | `haven up --agent -d` |
| One-shot health of every stack | `haven status --agent` (`--json` for a machine) |
| Read a service's log | `haven logs api --since 10m --agent` |
| Only warnings and worse | `haven logs api --level warn --agent` |
| Last distinct failures, grouped | `haven errors --agent` |
| Recent root spans of this stack | `haven traces --json` |

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
`LANGWATCH_DEV_ONE_PROCESS=1` ui, api and worker are one `app` lane: see `dev-runtime`.

```bash
haven logs api -t                 # follow one service
haven logs go --since 5m --level error
haven restart sims                # bounce one lane; nothing else restarts
haven restart api                 # restart the whole lane
```

Only `haven down` followed by `haven up` reloads a changed `.env`. `haven restart` does
not.

## The env, without leaking it

- `haven env` prints this stack's resolved environment with every secret masked
  (`<secret:masked>`, connection strings keep their shape). Safe to paste into an issue.
- `eval "$(haven env --reveal)"` loads the real values into your shell. Never paste
  that output, never print it, never read `.env` to find a value.
- Which keys are secret: every `Secret.load("ID")` handle found in source, plus any
  name that looks like a credential (`tools/thuishaven/domain/secretkeys.go`).
- The workspace `.env` beats haven's overlay. A value you set there wins; haven fills only
  what is unset.

## Other commands you will want

| Need | Command |
| --- | --- |
| Stop this stack, keep databases | `haven down` |
| Everything off, daemon and proxy too | `haven down --all` |
| Drop a stack's databases | `haven destroy <slug>` (needs `--yes` as an agent) |
| Reset or reseed this stack's data | `haven db reset [preset]`, `haven db seed [preset]` |
| Add or drop a service, sticky | `haven up +langy`, `haven up -mail` |
| Evaluators (monitors, evaluations) | `haven up +langevals` |
| Zero-cost model answers | `haven up +llm` |
| Try a PR in its own worktree | `haven pr <number>` |
| Hold Vite reloads during an agent turn | `haven hmr on --ttl 60s`, `haven hmr off` |
| Run a heavy command under the machine slot | `haven run`, `haven slot run -- <cmd>` |

Seed presets are in `haven help db` (`demo`, `onboarding`, `post-onboarding` and more).

## When it will not come up

`troubleshooting.md` (same folder) covers: a stack that is already up, the portless
proxy dying or holding root-owned state, `.localhost` not resolving on WSL2, Langy
needing `opencode` on the host, stale k8s URLs in `.env`, a frozen log, a blank page
that is only Vite re-optimising, and signing in for a browser check.

## Do not

- Run `haven up` or `haven down` on a checkout another session is using without asking.
- Name an app port in a URL you report. Name the hostname.
- Call a stack healthy because `haven up` returned. Check `haven status`, then the URL.
