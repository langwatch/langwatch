---
name: haven
description: "Daily use of thuishaven (`haven`), the dev-stack orchestrator: start, stop and inspect this worktree's stack, read logs, print the resolved env without leaking a secret, find the app and API URLs, and drive a stack as an agent. Use when someone says 'haven up', 'start the stack', 'is the stack up', 'haven logs', 'haven status', 'haven env', 'what is the app URL', 'app.<slug>.langwatch.localhost', 'haven up --agent -d', 'restart the api lane', 'reset the database', 'haven self install --build', 'stack home', 'haven orb feedback', 'the haven orb', or 'try a PR locally'. When the stack will not come up, or the page is blank or the log is frozen, read troubleshooting.md beside this file."
user-invocable: true
argument-hint: "[up | status | logs <service> | env | down | restart <lane> | db ...]"
---

# haven, day to day

`haven` (thuishaven) gives each worktree its own stack at hostnames, not ports. The
reference is `tools/thuishaven/README.md`; the processes and flags are in
`dev/docs/LOCAL_STACK.md`. `haven help <command>` lists every flag a command takes,
`haven help env` the knobs, `haven help hosts` the hostname scheme. Read those before
guessing a flag. Run it from the workspace root; `make haven <sub>` forwards to the CLI
(`dev/haven.mk`). This skill is the hub: each command group has its own skill, so load
only the part you need.

## Sub-skills

| Need                                                                                            | Skill                       |
| ----------------------------------------------------------------------------------------------- | --------------------------- |
| up, down, restart, reload, status, down --destroy, machine clean, self install, UI modes, lanes | `haven-lifecycle`           |
| logs, errors, obs traces, obs metrics, obs profiles, raw TraceQL/LogQL/PromQL                   | `haven-logs`                |
| the resolved env, masking, precedence, machine limits                                           | `haven-env`                 |
| reset, seed presets, connection strings, prune                                                  | `haven-db`                  |
| seeded data, logins, auto-seed                                                                  | `haven-seed`                |
| a signed-in storage state (`browser login`)                                                     | `haven-auth`                |
| a signed-in headless browser, record and replay                                                 | `haven-browser`             |
| the haven orb: feedback, page console and network                                               | `haven-orb`                 |
| try a PR: `haven pr`, `haven pr --throwaway`                                                    | `haven-play`                |
| slots, `haven machine typecheck`, the agent gate, `haven self upgrade`                          | `haven-machine`             |
| fake Stripe, mail, S3, IdP, LLM and the rest                                                    | `sims` and each `<name>sim` |

## As an agent

| Do                                          | Command                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Start without a log view that never returns | `haven up --agent -d`                                                                    |
| One-shot health of every stack              | `haven status --agent` (`--json <fields>` for a machine; bare `--json` lists the fields) |
| Read a service's log                        | `haven logs api --since 10m --agent`                                                     |
| Last distinct failures, grouped             | `haven errors --agent`                                                                   |
| Restart one lane                            | `haven restart sims`                                                                     |
| Logins and stack credentials                | `haven db seed --json --reveal`, `haven env --reveal` (never paste)                      |
| Keyed REST call, key never printed          | `haven api GET /api/... [--key project\|org\|personal] [--project slug]`                 |
| Which principal and scope a key has         | `haven api whoami --key org`                                                             |
| AI gateway call with a held virtual key     | `haven api --gateway POST /v1/chat/completions --body - [--vk name]`                     |

- Bare `haven up` without a TTY never returns and dies with your shell. Always `-d`.
- Bare `haven` prints a status summary and grouped help; the hub is `haven hub`.
- haven's own exit codes are 64 usage (a retired spelling names its replacement), 65 not running, 66 timeout, 67 refused by the gate; 0 to 63 are a wrapped command's own.
- Other stacks are aimed at with `--stack <slug>`; machine-wide commands (`machine`, `self`, `defaults`, `hub`) refuse it.
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

## The stack home

`https://<slug>.langwatch.localhost` (`apps/haven-web`) lists every surface with its status. A
surface that is not live says why (what it waits for and its lane's last warning), and its row has
Restart, or Start for a surface that was not selected. An api the stack refuses to serve because
the database is below the LTS floor shows a database reset button. `haven db reset` migrates and
seeds exactly the databases it dropped, also for a stack the hub does not know yet. The daemon
trusts a pid only together with its process start time, holds its claim as a flock for its whole
life, and writes stack records atomically, so a recycled pid or a second daemon cannot be mistaken
for ours (`tools/thuishaven/app/identity.go`).

## The consoles: always built, never a dev server

Every haven web console is a build served by Go; none runs Vite, Storybook dev or HMR.

| Console                                                                             | Where                                                                    | Served by                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub, stack home, seed console                                                       | `hub.langwatch.localhost`, `<slug>.langwatch.localhost`                  | the haven daemon (`apps/haven-web`, embedded)                                                                                                                       |
| Simulators: idp, mail, storage, voice, llm, analytics, outbound, payment, telemetry | `<sim>.<slug>.langwatch.localhost`                                       | the sim's Go binary in the `go` lane (`apps/<sim>sim-web`, embedded)                                                                                                |
| Design system Storybook (`+design-system`)                                          | `design-system.<slug>` (or `ds.<slug>`), and `/design-system` in the app | the `design-system` lane: `storybook build`, then `haven static`                                                                                                    |
| Mail studio (`+mail-room`)                                                          | `mail-room.<slug>`                                                       | the `mail-room` lane: `build:studio` renders every fixture at build time, then `haven static`; props are read-only (`pnpm --filter @langwatch/mail dev` edits live) |

- `haven self install --build` builds the hub and every simulator console (nx tag `haven-console`); each
  simulator lane rebuilds its console through the nx cache on start. A console missing its build
  serves a page naming the build command.
- The design-system lane rebuilds the Storybook only when `packages/design-system/storybook-static`
  is missing or older than its sources (about 10 s, 1.6 GB peak), then serves it at about 30 MB.
  `haven restart design-system` rebuilds after a change; `haven logs design-system` shows the build.
- The stack home's Seed panel runs `haven db seed --size <tiny|small|medium|large> --persona <all|...>`
  for a running stack and shows the last seed's status and the run's latest log lines.
- Every simulator has a CLI too: `haven sim payment customers|subscriptions|checkouts|invoices|complete <id>|retry <id>|fault off`,
  `haven sim mail`, `haven sim idp`, `haven sim storage`, `haven sim voice`, `haven sim llm`, `haven sim analytics`, `haven sim outbound`,
  `haven sim telemetry` (`haven help <name>`).

## When it will not come up

`troubleshooting.md` (same folder) covers: a stack that is already up, the portless
proxy dying or holding root-owned state, `.localhost` not resolving on WSL2, Langy
needing its `langy-worker` binary on the host, stale k8s URLs in `.env`, a frozen log, a blank page
that is only Vite re-optimising, and signing in for a browser check.

## Do not

- Run `haven up` or `haven down` on a checkout another session is using without asking. As an agent, a `haven up --force` or `make haven self install` on a stack that testers are driving is refused by the safety check: hand the command to the user.
- Search the repo with `git grep`, never `rg -uu` from the root: it walks `node_modules` and `.worktrees` at about 3 cores for minutes.
- Name an app port in a URL you report. Name the hostname.
- Call a stack healthy because `haven up` returned. Check `haven status`, then the URL.
