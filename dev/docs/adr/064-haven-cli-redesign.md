# ADR-064: haven CLI redesign: agents first, one name per command

**Date:** 2026-07-23 (amended 2026-10-10)

**Status:** Accepted. The amendment of 2026-10-10 supersedes the 2026-07-23
decision wherever they conflict; its first section lists each superseded point.

## Context

haven (`tools/thuishaven`) grew command by command. By July 2026 it had 23
top-level commands with 11 alias sets, `-f` and `--force` meaning different
things on different commands, four status surfaces, six ways to drop a
database and service selection spread over a dozen env vars. The 2026-07-23
decision (v2, below) replaced that with one name per command, one meaning per
flag, sticky service selection and automatic preparation.

By October 2026 the surface had grown back to 50 visible commands, and the
people typing them had changed. Most invocations now come from coding agents,
not from a developer at a terminal:

- Ten simulators each took a top-level noun (`mail`, `llm`, `payment`, ...),
  each with its own verbs for the same job (`calls`, `records`, `requests`,
  `events` all mean "what you caught"; `set --error` and `fail` and `tamper`
  all mean "answer badly").
- The viewer's tabs became commands (`traces`, `metrics`, `profiles`,
  `stores`, `jobs`) beside `logs` and `errors`, and `auth`, `mfa`, `page` and
  `feedback` sat beside `browser`, the thing they drive.
- Bare `haven` opened an interactive TUI, which an agent can only fail on.
- `--json` shapes were per command, unversioned and unselectable; exit codes
  did not distinguish "you typed it wrong" from "the stack is down" from "it
  timed out", so an agent could not tell which to fix.
- Which stack a command meant came from the working directory alone.

## Decision (2026-07-23, v2)

Where the amendment below conflicts with this section, the amendment wins;
its first table lists each superseded point.

We will throw the current surface out and replace it, not deprecate it in
place. haven is an internal dev tool with a handful of users; a clean break
costs each of them minutes and removes the alias/env compatibility surface
forever. Removed spellings fail with a one-line pointer at the new spelling —
they never keep working silently.

### The rules

1. **One name per command, one command per job.** No aliases, ever. Anyone
   who wants `haven ps` can alias it in their own shell.
2. **One meaning per flag, everywhere.** A shorthand letter or long flag
   means the same thing on every command that accepts it. `-t` is `--tail`
   and nothing else. `-f` is `--force` — forcing the _lifecycle_ action, and
   only on `up` (restart even a matching stack) and `down` (kill hard, no
   graceful shutdown); destructive _data_ actions confirm with `--yes`,
   never `--force`. `--json` and `--agent` are global. `--rebuild` means
   "rebuild the image" wherever it appears.
3. **`up` is declarative and idempotent.** `haven up` means "make this
   worktree's stack match its service selection". Not running → start.
   Already running and matching → a friendly no-op. Selection changed →
   the stack is replaced in place with the new one. There is no
   refuse-then-`--force` dance to memorise.
4. **Everything preparatory is automatic.** Proxy install and CA trust,
   dependency install, database create/migrate/seed, database _recovery_,
   and image ensure are idempotent preflight steps of `up` — not separate
   commands you must know to run, and not errors you must know how to fix.
5. **Logs are a first-class tap.** Every service's output is captured
   per-service whether the stack is attached or detached, and `haven logs`
   can replay, follow, and filter it from any terminal.
6. **Data loss is always explicit.** `down` never touches data. Destructive
   operations live under two nouns (`db`, `clean`), always confirm in a TTY,
   and never destroy in agent mode without `--yes`.

### The surface

Daily driver:

```text
haven                 the hub: every stack, health, RAM, actions (agents/pipes get plain status)
haven up [+svc|-svc] [-f]  start or reconcile this worktree's stack; deltas stick; -f restarts
haven down [-f] [--all]    stop this stack, keep all data; -f kills hard; --all stops everything
haven restart [svc] [--rebuild]   bounce one service or all; --rebuild re-images container services
haven logs [svc…] [-t] [--since 10m] [--level warn] [--stack slug]
haven status [--json] one-shot: selection, service health, shared-server health, RAM (absorbs list+doctor)
```

Data and cleanup (the only destructive nouns):

```text
haven db reset [preset] [--yes]   fresh migrated+seeded databases for this stack
haven db seed [preset]            reseed in place — idempotent, drops nothing
haven db url [postgres|clickhouse|redis]   connection strings
  presets (shared): demo · traces · onboarding · post-onboarding · bare · mass
  (mass = demo plus months of backdated history: event-log seeding with backdated
  occurredAt + projection replay for the event-sourced products; recent traces
  through the collector, older ones as recordSpan commands — the ingest guard is
  deliberately not weakened; plus months of OTLP metric series)
haven clean [--yes]   one interactive cleanup: worktrees, artifacts, idle DBs, orphan processes
```

**Data retention.** A dev stack keeps only **7 days** by default so ClickHouse
stays small and whole weekly partitions drop cleanly (the partition key is
`toYearWeek`, so retention is always a whole number of weeks). haven pins it
through `LANGWATCH_DEFAULT_RETENTION_DAYS=7` in every process it starts; the control
plane reads that override only outside production and **fails loud at start-up if
it is ever set in prod**, where the platform default is fixed — lowering it there
would silently expire customer data. Because a 7-day window would immediately
cull seeded data (and instantly expire the mass preset's backdated rows, which
are stamped `TTL = data time + retention`), every data-loading preset runs a
`seed:retention` step first that pins a **two-year, partition-aligned**
RetentionPolicy (728 days = 104 weeks; a deeper mass window scales it up). A
bare, unseeded database keeps the 7-day default.

Workflow tier, unchanged in behaviour but de-aliased:

```text
haven pr <ref>        try a GitHub PR in a fresh worktree (--force renamed --allow-closed)
haven play [pr]       run a PR in a throwaway sandbox; quitting destroys everything it created
haven git [target]    embedded git TUI across worktrees
haven switch [name]   cd helper (with shell-init)
haven shell-init      emit the shell function + completion
haven hmr on|off      AI-gated HMR
haven typecheck       RAM-slotted pnpm typecheck
haven upgrade         reinstall the haven binary
```

Hidden: `haven daemon` (internal, auto-spawned). `help` and `version` remain.

That is 14 visible commands, zero aliases — down from 23 commands with 11
alias sets. The daily surface is six verbs.

### Service selection

Per-worktree services are `workers` (standalone lane), `gateway`, `nlp`, and
`langy` (canonical short names; `langyagent` and `aigateway` are no longer
accepted spellings). `app` always runs and is not selectable. Selection is
expressed as deltas on `up` and is **sticky**:

```text
haven up +langy       add langy to this worktree's stack, now and from now on
haven up -nlp         stop running nlp here; the hostname falls back to the shared baseline
haven up              whatever this worktree last selected
```

The selection lives in a small worktree-local file (`.haven.json`, gitignored,
next to `.langwatch-slug`), is printed by `status` and the hub, and survives
terminals, reboots, and detach. `up` on a running stack reconciles: a matching
selection is a friendly no-op; a changed one replaces the stack in place with
the new selection — the current implementation restarts the whole stack (the
old force-replace path, now automatic and delta-framed), because a genuinely
incremental delta would need the running app's environment re-plumbed (ports,
OPENCODE_AGENT_URL) mid-flight. Bouncing only the delta is the recorded
follow-up optimisation.

**Defaults flip to lean.** A fresh worktree runs `app` (workers in-process),
`nlp`, and `gateway` — and _not_ `langy`. langy costs a container image and a
1.8 GB memory cap that most worktrees never exercise; the worktrees that need
it say `+langy` once. The first `up` prints the selection and how to change
it, so the lean default is discoverable rather than mysterious.

The old selection env vars (`LANGWATCH_SKIP_*`, `START_WORKERS`,
`WORKERS_IN_PROCESS=0`) are removed outright rather than bridged. A bridge is
worse than either alternative here: honouring an env var makes `status` lie
about the stack it just started, and ignoring one silently runs services the
developer believes they turned off. So `up` refuses them and names the one
command that replaces each — the same treatment removed command spellings get,
and a one-time fix because the replacement is sticky. Only the values that used
to change what ran are refused: `WORKERS_IN_PROCESS=1` is still how plain
`pnpm dev` asks for a single process, and haven itself passes it to the app
child, so it must not block a stack. `START_WORKERS=false` has no replacement —
the worker stack is part of the app now, and `+workers` only moves it into its
own lane. Repo scripts
(the since-removed `pnpm dev:haven` / `pnpm dev:workers:haven`) are rewritten to the new flags in
the same change. Machine-level opt-outs of haven managing a shared server
(`LANGWATCH_HAVEN_CH=0` and friends) are rare, deliberate, and stay env vars.

Shared infrastructure — the portless proxy, daemon, ClickHouse server,
Postgres, Redis, and the observability stack — is not part of per-worktree
selection. It is managed automatically, reported by `status`, restartable by
name (`haven restart obs`), and stopped machine-wide by `haven down --all`.

### Automatic preparation and recovery

`up` owns the entire path from a fresh machine to a running stack:

- **Bootstrap.** Portless missing → install it; CA untrusted → trust it;
  proxy down → start it. `haven setup` is deleted; there is no one-time step.
- **Dependencies.** Lockfile newer than the last install → `pnpm install`
  before starting. Go toolchain checked once with a clear pointer if absent.
- **Databases.** Missing → create + migrate + seed (as today). Server or
  container stopped → start it. Container wedged/unhealthy → recreate the
  container, preserving the data volume. Migration fails on an existing
  database → **never** silently drop; fail with the error and the exact
  recovery command (`haven db reset`).
- **Images.** Container images are content-addressed: the langy image tag is
  derived from a hash of its build inputs (Dockerfile + the curated COPY
  list). Hash matches a local image → reuse, zero build. A CI-published
  prebuilt for that hash exists → pull instead of build. Otherwise → build
  locally, once, until the inputs actually change. `--rebuild` on `up` or
  `restart` forces it. `HAVEN_LANGY_REBUILD` is deleted. ClickHouse and LGTM
  keep their pinned upstream images.

### Logs

The supervisor always writes per-service, size-capped log files under the
haven home (`logs/<slug>/<service>.log`), attached or detached — the terminal
view in attached mode is just a live rendering of the same tap. Consequently:

- `haven logs` prints the recent interleaved tail of every service of this
  worktree's stack, each line labelled with its service, levels colourised.
- `haven logs nlp` filters to one service; multiple names combine.
- `-t`/`--tail` follows; `--since 10m` windows; `--level warn` filters
  structured lines by severity; `--stack <slug>` reads another worktree's
  stack.
- Logs outlive the stack: after `down` (or a crash) the last run's logs are
  still readable — which is precisely when you want them.
- `obs` is a valid log target (replacing `make observability-logs`).

### Session dashboard (attached tab one)

The attached view (`haven up` and `haven play` alike) opens on a live session
dashboard, not a log stream. Tab one is a status-and-actions screen; the
combined `all` stream and the per-service log groups follow it.

- **Status of everything, cheaply.** An ASCII harbour wordmark, then the
  stack's liveness and process-group RAM, every routed service with an up/down
  dot and where it is reached, and the shared machinery (proxy, daemon, the
  managed ClickHouse/Postgres/Redis, observability) as dot pills. The snapshot
  (`app/session.go`, `SessionSnapshot`) runs only cheap probes — port checks,
  process liveness, group RSS — so the view refreshes on a slow (~1.2s) beat
  without ever shelling into docker for a health ping.
- **Per-service actions.** Arrow keys move a cursor over the services; `enter`
  jumps straight to that service's log tab (or the combined stream when it has
  no capture yet); `r` bounces the highlighted service and `a` bounces them
  all, through `RestartStackQuiet` — a message-returning sibling of
  `RestartStack` so the bounce reports as a toast instead of writing into the
  alt-screen. Only services this worktree runs itself are restartable; a
  baseline fallback or a shared database server refuses with a toast.
- **The dashboard is opt-in on wiring.** It appears only when the viewer is
  handed an action surface (`sessionActions`, the same callback shape the hub
  uses). A log-only viewer has no tab one and opens on `all` as before.

### What is cut, and where it went

| Today                                             | v2                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `setup`                                           | automatic preflight of `up`                                                                          |
| `list` / `ls` / `status`-alias, `doctor`, `watch` | `haven status` (one-shot) and the bare-`haven` hub                                                   |
| `hub` / `ps` / `active`                           | bare `haven` only                                                                                    |
| `up -f/--force`                                   | `up` reconciles; `-f` now means "restart even a matching stack"                                      |
| `up -w/--watch`                                   | unchanged flag, only meaning of `--watch`                                                            |
| `down --drop-db` / `--keep-db`                    | `down` keeps data, always; fresh data is `haven db reset`                                            |
| `clickhouse` / `ch`, `postgres` / `pg` subtrees   | `haven db url`, `haven db reset`; server lifecycle is automatic                                      |
| `observability` / `obs` subtree                   | managed automatically; `restart obs`, `logs obs`, `status`                                           |
| `seed [--preset demo]`                            | `haven db seed [preset]` (in place) / `haven db reset [preset]` (fresh)                              |
| `prune`, `prune --artifacts`, `cleanup` / `oc`    | `haven clean` (one interactive picker, categories: worktrees, artifacts, idle DBs, orphan processes) |
| `pr --trusted` / `--allow-scripts`, `pr --force`  | `--allow-scripts` only; `--allow-closed`                                                             |
| `hmr pause` / `resume`                            | `hmr on` / `off` only                                                                                |
| `git --list` vs `switch --list` divergence        | `--json` on `git`; `switch --list` stays (completion)                                                |
| selection env vars                                | sticky `up +svc` / `-svc` (the env vars are refused, naming their replacement)                       |
| `HAVEN_LANGY_REBUILD`                             | content-hashed images + `--rebuild`                                                                  |

### haven play: an ephemeral PR sandbox

`haven play [pr]` is a workflow-tier verb, sibling of `pr`, not a daily
driver: it exists for reviewing someone else's work, which happens a few
times a day at most, while the daily tier is about your own worktree. The
two commands split one job cleanly: `pr` gives a PR a persistent worktree on
the shared servers (a lasting checkout you might edit), `play` gives it a
disposable sandbox with dedicated infrastructure that is destroyed the
moment you quit.

The rules it adds, and how they honour the constitution:

- **Isolation is total.** The sandbox gets its own git checkout (under the
  haven home, not among real worktrees), its own Postgres, ClickHouse, and
  Redis containers and volumes (all `haven-play-<n>-*` names on freshly
  allocated loopback ports, provably disjoint from the shared
  `langwatch-db-data`/`langwatch-clickhouse-data`/`langwatch-redis-data`
  volumes and the shared Redis on 6379), and its own `play-<n>` slug, which
  can never equal a `haven pr` checkout's `pr-<n>` slug, so both can exist
  for the same PR.
- **Trust is gated before checkout, on authenticated facts only.** What
  counts as proof depends on where the head branch lives, because commit
  metadata is not evidence of anything. A commit's author and committer are
  free-text git headers, and GitHub's own `author`/`committer` objects are
  just a lookup of those attacker-chosen emails against accounts' verified
  addresses — the `<id>+<login>@users.noreply.github.com` form is publicly
  derivable, so anyone can make a commit _appear_ to be a maintainer's.
  Therefore:
  - **Same-repo PR** — the branch exists in this repository, which required
    push access to create, so the code already passed a real access check.
    Every commit author and committer is checked for write access, and an
    identity with no GitHub account is untrusted by definition.
  - **Fork PR** — attribution proves nothing, so only a commit carrying a
    signature GitHub _verified_, whose verified signer has write access,
    counts as trusted. Every other commit is named as untrusted by sha.

  A listing that hits GitHub's 250-commit cap fails closed rather than
  vouching for commits it never saw. Any untrusted commit stops play: a hard
  failure in agent mode, where `--allow-untrusted` is the only way past. Not
  `--force`: that letter is lifecycle-only, and accepting untrusted code
  deserves a flag that says exactly what it does.

- **Accepting untrusted code takes two steps, not one keystroke.** In a
  terminal the gate asks twice, because the two questions are different. The
  first names the authors without write access and takes a y/N, defaulting to
  no. The second discloses the part the sandbox's isolation does _not_ cover,
  then accepts only the PR's number typed back.

  That second step exists because "isolated" is easy to over-read. The
  isolation is of the PR's _data_ — dedicated databases, volumes, hostnames and
  checkout, and none of the developer's `.env` files. It is not a boundary
  around the developer: the install, migrations, seed and service commands are
  ordinary child processes, so they run under the developer's own account and
  inherit the environment haven was launched from, and whatever that shell
  exports — SSH agent socket, GitHub, cloud and registry tokens — goes with
  them, alongside reachable home directory and network. Containerising the
  sandbox's _execution_ would be the way to close that, and is deliberately out
  of scope here; what this decision buys instead is that nobody accepts it
  without being told, and nobody accepts it by reflex. Typing the number cannot
  be muscle memory the way a `y` can, and it means having read far enough to
  know which PR is about to run.

  The same disclosure rides every route that ends in a stranger's code
  running — the second step, the `--allow-untrusted` warning line, and the
  agent-mode failure — so no path to it is quieter than the others.

- **The sandbox never runs a checkout's package scripts.** Installs use
  `--ignore-scripts` unconditionally, because this repo has a postinstall and
  a PR controls package scripts — a plain install would execute PR-authored
  code with the developer's environment before any gate on the _application_
  code mattered. Nothing is lost: the postinstall is codegen, which the
  sandbox then runs explicitly through `start:prepare:files`.
- **Quitting always destroys everything** (processes, hostnames, containers,
  volumes, checkout, record), the exact opposite of `up`, where q detaches.
  No `--yes` is asked at teardown: the data-loss-is-explicit rule is
  satisfied by upfront disclosure instead, in the command's help line and in
  a banner printed before anything is created. Teardown is ordered,
  best-effort (a failed step never stops the rest), and deferred behind the
  signal context, so SIGINT/SIGTERM/panic still run it.
- **A hard death is recoverable.** The sandbox is recorded before any
  resource exists; `haven clean` reaps any sandbox whose owning process is
  gone by finishing the same teardown.
- **`--seed <preset>` reads the same registry as `db seed`.** A sandbox's
  databases are born empty, so a PR about anything past onboarding opens on
  the wrong screen. The presets are not duplicated for play and there is no
  play-only variant — one list, one meaning, per the flag rule above. Where
  each half lands differs by necessity: the preset's switches go to the
  sandbox's own seed, before its services start, while data that travels
  through the collector can only land once the sandbox is serving, so it runs
  in a lane beside the supervised set that waits on the sandbox's own
  `/api/health`. That lane is a warning path end to end — a failed ingest
  names the step and the command that retries it and leaves the sandbox
  running, because a PR that broke the collector is precisely one worth
  watching — but teardown still waits for it to stop, rather than racing a
  `docker volume rm` against a process still writing.

Spec: `specs/setup/haven-play.feature`.

## Amendment 2026-10-10: agents first, nouns for tools, one output contract

Decided by Alex on 2026-10-10. The v2 rules that survive are rules 1, 3, 4, 5
and 6 (one name per command, declarative `up`, automatic preparation, logs as
a tap, explicit data loss), sticky service selection, automatic recovery, data
retention, and the whole trust and teardown design of the PR sandbox, which now
lives under `pr --throwaway`. Spec: `specs/setup/haven-cli-surface.feature`.

### What this supersedes

| v2 (2026-07-23) or later addition                                   | Now                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Bare `haven` opens the hub                                          | Bare `haven` prints a status summary and grouped help; the hub is `haven hub` |
| `-t` is `--tail` everywhere; `-f` is lifecycle `--force` on up/down | `logs -f` follows (see Flags); `-t` is retired                                |
| Destructive actions live under `db` and `clean`                     | Under `db`, `down --destroy` and `machine clean`                              |
| `destroy <slug>` (added after v2)                                   | `down --destroy`, aimed with `--stack`                                        |
| `play` is a sibling of `pr`                                         | `pr <n> --throwaway`; the sandbox rules are unchanged                         |
| Workflow tier: `git`, `shell-init`, `hmr`, `typecheck`, `upgrade`   | `git` and `hmr` deleted; the rest move under `self` and `machine`             |
| `setup` deleted (no one-time step)                                  | `self setup` exists for optional integrations and the `switch` shell line     |
| Retired spellings `hub`, `obs`, `doctor`                            | Live again: `hub`, the `obs` group, `self doctor`                             |
| `db seed [preset]` beside `seed` (tiers, personas)                  | One `db seed`; logins move to `db logins`                                     |
| One top-level noun per simulator, plus `sims`                       | `sim <name> <verb>` with a shared core vocabulary; bare `sim` lists them      |
| The daily surface is six verbs                                      | The daily surface is the top level below                                      |

### Who the CLI is for

The primary user is an agent; humans get the hub. **Agent mode is automatic**:
when stdout is not a TTY, or an agent environment variable is set
(`CLAUDECODE`, any `CODEX_*`, and the equivalents of other coding agents),
haven asks no questions, prints no colour and detaches anything it starts.
`--agent` stays as an explicit override. In agent mode a long command (`up`,
`db reset`, `pr`, `machine typecheck`, `machine run`) prints a bounded summary
plus the path of a full log file, so the caller reads the whole log only when
the summary says it must.

### The surface

```text
haven                       status summary + grouped help (never interactive)
haven hub                   the interactive hub (humans)

Daily
  up [+svc -svc]            start or reconcile this stack; deltas stick for THIS stack
  down [--all] [--destroy]  stop; --destroy also drops this stack's databases
  restart [svc]             bounce one service, or all
  reload [app|api|worker|ui]  move a host onto the current code
  status                    this stack: services (and where each choice came from), jobs, stores
  logs [svc…] [-f]          captured logs; -f follows
  errors                    the last distinct failures, grouped and counted
  env                       this stack's resolved environment
  browser <verb>            the shared headless browser (login, mfa, record, ...)
  pr <n> [--throwaway]      a PR in a lasting worktree + stack; --throwaway deletes all on quit
  switch <name>             cd to a worktree (shell function from `self setup`)
  wait --for ready|stopped [--timeout <dur>]
  defaults [+svc -svc]      the machine-wide default service set; bare lists it

Groups
  sim [<name> <verb>]       every simulator; bare lists them
  obs traces|metrics|profiles|query
  orb feedback|console|network
  db reset|seed|url|prune|logins
  api <METHOD> <path> | whoami
  machine limits|run|slot|typecheck|clean
  self install|setup|upgrade|doctor|shell-init

Hidden (dispatchable, absent from help)
  simulator  static  go-watch  ui-watch  keep  daemon  gate
```

### Services: this stack and the machine default

`up +llm -langy` adds and removes services for this stack and sticks, as v2's
selection did. `haven defaults +svc -svc` edits the machine-wide default set a
stack starts from; bare `haven defaults` lists it. A stack's own choices win
over the defaults, and `status` (and `status --json`) shows, for each service,
whether it runs because of this stack's choice or because of the defaults.

### Destroying a stack

`down --destroy` replaces `destroy`: it stops the stack and drops its
databases. In a terminal the developer types the stack's slug to confirm; a
plain `y` does not count. In agent mode it refuses with exit 64 unless `--yes`
is passed. Another stack is aimed at with `--stack <slug>`, like everything
else.

### Pull requests

`pr <n>` absorbs `play`. Without a flag it makes a lasting worktree and stack
(today's `pr`). `--throwaway` gives today's `play` sandbox: own checkout and
databases, deleted on quit, with the trust gate, the two-step acceptance, the
`--ignore-scripts` install and the ordered teardown of the v2 section "haven
play: an ephemeral PR sandbox" unchanged. The ref forms `pr` accepts today stay
accepted.

### switch and the shell

`switch <name>` stays top level. The shell function that makes it a real `cd`
comes from `haven self setup`, which offers to add one line to `~/.zshrc` and
changes nothing if declined. Without the function, `switch` prints the path and
a one-line hint naming `haven self setup`. `shell-init` moves to
`self shell-init`.

### Simulators: one vocabulary

`haven sim` lists every simulator: running here or not, its console, the
`+name` that starts it, its verbs and its skill. Each simulator is
`haven sim <name> <verb>`, for mail, llm, payment, storage, idp, outbound,
analytics, lambda, voice and telemetry. The core vocabulary is the shared
spelling for a concept a simulator has; it is optional per simulator, and no
simulator grows a no-op verb to fill the set:

| Core verb  | Meaning                                                         |
| ---------- | --------------------------------------------------------------- |
| `status`   | running or not, address, console URL, current fault             |
| `list`     | what it caught, newest first, with the sim's filters            |
| `get <id>` | one caught record                                               |
| `wait`     | block until a matching record arrives (`--timeout`, exit 66)    |
| `clear`    | forget what it caught (state the sim owns, never its catalogue) |
| `fault`    | inject an error (`fault <spec>`); `fault off` removes it        |
| `console`  | the URL of the sim's web console                                |

Settings that are not faults live under `config` (`sim llm config --seed 42`).
Simulator-specific verbs sit on top. Every current verb has one home:

| Simulator   | Current verb -> core                                                                                    | Kept as extras                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail`      | `inbox`->`status`, `list`, `get`, `wait`, `clear`, `set --error`->`fault`                               | `address`, `links <id>`, `delete <id>`                                                                                                                                                                      |
| `llm`       | `info`->`status`, `calls`->`list`, `call <id>`->`get`, `clear`, `set --error`->`fault`                  | `set --seed <value>`->`config --seed <value>`                                                                                                                                                               |
| `analytics` | `status`, `records`->`list`, `clear`, `wait`, `set --error`->`fault`                                    | none                                                                                                                                                                                                        |
| `outbound`  | `status`, `records`->`list`, `clear`, `wait`, `fault` (keeps `add\|list\|clear`)                        | `deliveries`, `receiver add\|list\|clear\|set`, `urls`                                                                                                                                                      |
| `lambda`    | `info`->`status`, `calls`->`list`, `call <id>`->`get`, `clear`, `set --error`->`fault`                  | none                                                                                                                                                                                                        |
| `payment`   | `status`, `events`->`list`, `reset`->`clear`, `fail`->`fault`, `clear-failures`->`fault off`            | `customers`, `subscriptions`, `checkouts`, `invoices`, `usage`, `complete`, `retry`, `advance`, `deliver`, `hold`, `release`                                                                                |
| `storage`   | `requests`->`list`, `clear [bucket]`, `set --error`->`fault`                                            | `buckets`, `objects`, `object`, `presign`, `delete`, `seed`                                                                                                                                                 |
| `idp`       | `tenants`->`list`, `tenant show`->`get <tenant>`, `reset <tenant>`->`clear <tenant>`, `tamper`->`fault` | `apps`, `populate`, `churn`, `user add\|disable\|enable`, `dns`, `verification`, `activity`, `signin`, `samlp`, `legacy`, `skew`, `rotate-key`, `scim …`, `scim-event`, `auth0-webhook`, `saml unsolicited` |
| `voice`     | `status`, `calls`->`list`, `call <id>`->`get`, `clear`                                                  | none                                                                                                                                                                                                        |
| `telemetry` | `status`, `runs`->`list`, `run <id>`->`get`, `console`                                                  | `send`, `load`, `fuzz`, `post`, `fixtures`, `fixture`, `stop`                                                                                                                                               |

Bare `haven idp`, which ran the standalone IdP simulator, becomes the hidden
`haven simulator idp` that already runs every sim standalone.

### Observability, the orb, data, the browser

- `obs traces|metrics|profiles|query` replaces the top-level `traces`,
  `metrics`, `profiles` and `query`. `logs` and `errors` stay top level.
- `orb feedback|console|network` replaces `feedback` and `page`.
  **Requirement:** the orb is injected into built-UI pages on haven stacks, not
  only the Vite dev server's, and never into a production build.
- `db reset|seed|url|prune|logins`. `haven seed` folds into `db seed`, which
  keeps both the preset argument and today's `seed` flags (tiers, personas,
  history). `db logins` prints the seeded logins, credentials masked unless
  `--reveal`.
- `browser` absorbs `auth` as `browser login --as <who>` (still writing the
  Playwright storage state, never printing a password) and `mfa` as
  `browser mfa add|list|remove|uv|totp`.
- `api <METHOD> <path> | whoami` stays its own group; `--gateway` sends the
  call to this stack's AI gateway with a virtual key haven mints and holds
  (replacing `haven gateway`), with the same never-printed key handling.
- `db status` reports the connection URLs, the last seed run, its preset and
  the migration state (replacing `seed status`).
- `status` gains the `jobs` and `stores` tables as sections, and as fields of
  `status --json`.

### Targeting

Every stack-scoped command takes `--stack <slug>`; the machine-wide ones
(`machine`, `self`, `defaults`, `hub`) refuse it with the usage exit. Without it, the `HAVEN_STACK`
environment variable decides (set per shell or per agent; there is never a
machine-global "current stack"). Without that, the worktree containing the
working directory decides. Without that, a terminal gets a picker and an agent
gets exit 64 with the list of slugs. An unknown slug is exit 64 with the same
list. Structured output always reports the stack it resolved.

### Output contract

- Every `--json` output is an object `{"v":1, ...}` with a published schema.
- `--json f1,f2` selects fields; bare `--json` on a command that has fields
  lists them (as `gh` does); an unknown field is exit 64 naming the valid ones.
- Streams (`logs -f --json`, watches, job progress) are NDJSON: one typed
  event per line with a `type` discriminator.

### Exit codes

haven's own codes sit at 64 and above, so a wrapped command's 0 to 63 passes
through untouched and the two never collide.

| Code    | Meaning                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0       | ok                                                                                                                                |
| 64      | usage: unknown command or flag, retired spelling, unknown or ambiguous target, a destructive action without `--yes` in agent mode |
| 65      | not running: the stack, service or simulator the command needs is down                                                            |
| 66      | timeout (`wait`, `sim … wait`, any `--timeout`)                                                                                   |
| 67      | refused by the machine gate                                                                                                       |
| 0 to 63 | a wrapped command's own code, untouched (`machine run`, `machine slot run`, `machine typecheck`)                                  |

### Flags

`--json`, `--agent` and `--stack` are global. `-f` on `logs` means
`--follow`, which retires `-t`/`--tail` (`haven logs -t` exits 64 with
`now: haven logs -f`). Because a shorthand still means one thing across the
CLI, `up` and `down` keep `--force` only in its long form.

### Compatibility

A clean break. Every old spelling exits 64, changes nothing, and names the exact
new spelling with the caller's arguments carried over, for example
`now: haven sim mail list`. A deleted command with no successor says so in one
line. The implementation PR sweeps skills, docs, scripts and the `make haven`
passthrough in the same change.

### Old -> new, every current command

The 57 entries of `cmd/table.go` (50 visible, 7 hidden) plus bare `haven`,
`help` and `version`; one row each.

| Current                              | New                                                             | Note                                             |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------ |
| `haven` (bare: hub)                  | `haven` (status summary + help); hub is `haven hub`             |                                                  |
| `up [+svc\|-svc]`                    | `up [+svc -svc]`                                                | agent mode detaches; `-f` becomes `--force` only |
| `down [--all] [-f]`                  | `down [--all] [--destroy]`                                      | `-f` becomes `--force` only                      |
| `destroy <slug>`                     | `down --destroy --stack <slug>`                                 | typed slug in a TTY; `--yes` for agents          |
| `restart [service]`                  | `restart [svc]`                                                 |                                                  |
| `reload [app\|api\|worker\|ui]`      | `reload [app\|api\|worker\|ui]`                                 |                                                  |
| `idp [verb]`                         | `sim idp <verb>`; bare -> hidden `simulator idp`                | verbs per the simulator table                    |
| `limits`                             | `machine limits`                                                |                                                  |
| `mail …`                             | `sim mail …`                                                    | verbs per the simulator table                    |
| `llm …`                              | `sim llm …`                                                     | verbs per the simulator table                    |
| `analytics …`                        | `sim analytics …`                                               | verbs per the simulator table                    |
| `outbound …`                         | `sim outbound …`                                                | verbs per the simulator table                    |
| `lambda …`                           | `sim lambda …`                                                  | verbs per the simulator table                    |
| `payment …`                          | `sim payment …`                                                 | verbs per the simulator table                    |
| `feedback list\|show\|resolve\|wait` | `orb feedback list\|show\|resolve\|wait`                        |                                                  |
| `page console\|network`              | `orb console\|network`                                          |                                                  |
| `storage …`                          | `sim storage …`                                                 | verbs per the simulator table                    |
| `sims`                               | `sim`                                                           |                                                  |
| `voice …`                            | `sim voice …`                                                   | verbs per the simulator table                    |
| `logs [service…] [-t]`               | `logs [svc…] [-f]`                                              |                                                  |
| `query <traceql\|logql\|promql> <q>` | `obs query <traceql\|logql\|promql> <q>`                        |                                                  |
| `seed [flags]`, `seed status`        | `db seed [preset] [flags]`, `db status`; logins via `db logins` |                                                  |
| `api <METHOD> <path> \| whoami`      | `api <METHOD> <path> \| whoami`                                 |                                                  |
| `gateway <METHOD> <path>`            | `api <METHOD> <path> --gateway`                                 | same key handling                                |
| `telemetry …`                        | `sim telemetry …`                                               | verbs per the simulator table                    |
| `auth <admin\|email>`                | `browser login --as <admin\|email>`                             | still writes Playwright storage state            |
| `browser <verb>`                     | `browser <verb>`                                                | gains `login` and `mfa`                          |
| `mfa add\|list\|remove\|uv\|totp`    | `browser mfa add\|list\|remove\|uv\|totp`                       |                                                  |
| `status`                             | `status`                                                        | gains service origin, jobs and stores sections   |
| `env`                                | `env`                                                           |                                                  |
| `db reset\|seed\|url\|prune`         | `db reset\|seed\|url\|prune\|logins`                            |                                                  |
| `pr <ref>`                           | `pr <n>`                                                        | lasting worktree + stack                         |
| `play [pr]`                          | `pr <n> --throwaway`                                            | sandbox rules unchanged                          |
| `play-launch` (hidden)               | deleted; folded into `pr --throwaway`                           |                                                  |
| `git [target]`                       | deleted                                                         | the git TUI goes; no successor                   |
| `switch [name]`                      | `switch <name>`                                                 | prints path + hint without the shell function    |
| `shell-init`                         | `self shell-init`                                               |                                                  |
| `hmr [on\|off\|status]`              | deleted                                                         | was a retired no-op                              |
| `clean`                              | `machine clean`                                                 |                                                  |
| `run --sh <command>`                 | `machine run --sh <command>`                                    | exit code passes through                         |
| `install [prerequisite…]`            | `self install [prerequisite…]`                                  |                                                  |
| `setup [feature…]`                   | `self setup [feature…]`                                         | also offers the `switch` line for `~/.zshrc`     |
| `gate`                               | `gate` (hidden)                                                 | answered by the PreToolUse hook only             |
| `slot run\|explain`                  | `machine slot run\|explain`                                     | exit code passes through                         |
| `typecheck [--affected\|--all]`      | `machine typecheck [--affected\|--all]`                         | exit code passes through                         |
| `upgrade`                            | `self upgrade`                                                  |                                                  |
| `errors`                             | `errors`                                                        |                                                  |
| `traces [trace-id]`                  | `obs traces [trace-id]`                                         |                                                  |
| `metrics`                            | `obs metrics`                                                   |                                                  |
| `profiles`                           | `obs profiles`                                                  |                                                  |
| `stores`                             | `status` (stores section; `status --json stores`)               | deleted as a command                             |
| `jobs`                               | `status` (jobs section; `status --json jobs`)                   | deleted as a command                             |
| `simulator` (hidden)                 | `simulator` (hidden)                                            |                                                  |
| `static` (hidden)                    | `static` (hidden)                                               |                                                  |
| `go-watch` (hidden)                  | `go-watch` (hidden)                                             |                                                  |
| `ui-watch` (hidden)                  | `ui-watch` (hidden)                                             |                                                  |
| `keep` (hidden)                      | `keep` (hidden)                                                 |                                                  |
| `daemon` (hidden)                    | `daemon` (hidden)                                               |                                                  |
| `help [command]`, `version`          | unchanged                                                       |                                                  |

New, with no predecessor: `hub` (was bare `haven`), `wait`, `defaults`,
`db logins`, `db status`, `self doctor`, `api --gateway`.

Spellings retired by v2 keep failing, with their pointers updated: `ls`,
`list` -> `haven status`; `watch`, `ps`, `active` -> `haven hub`; `rs` ->
`haven restart`; `sw`, `cd` -> `haven switch`; `ch`, `clickhouse` ->
`haven db url clickhouse`; `pg`, `postgres` -> `haven db url postgres`;
`observability` -> `haven obs`; `tc` -> `haven machine typecheck`; `oc`,
`cleanup`, `prune` -> `haven machine clean`; `moron` -> deleted with `git`;
`doctor` -> `haven self doctor`. `hub` and `obs` leave the retired list
because they are live again.

### Rulings of 2026-10-10 on the mapping

Raised while mapping and ruled by Alex the same day: `gateway` becomes
`api --gateway`; `seed status` becomes `db status`; machine-wide commands
refuse `--stack`; `logs -f` follows, `-t` is retired and `up`/`down` keep
`--force` long-only; haven's exit codes move to 64 and above; core simulator
verbs are optional and settings live under `config`; `play-launch` folds into
`pr --throwaway`. The verb choices in the simulator table stand as written.

## Rationale / Trade-offs

The alternative — deprecate aliases gradually, keep env vars working, add the
new commands alongside — preserves muscle memory at the cost of keeping every
confusion this ADR exists to remove, indefinitely, in a tool whose entire user
base fits in one room. We accept a one-morning break for a permanently smaller
surface.

Making `up` declarative removes the only _safety_ use of `--force` (replacing
a half-dead stack), so reconciliation must genuinely handle the
already-running, half-running, and stale-registry cases; the lifecycle spec
pins those. Flipping langy to opt-in trades a surprise for a much better one:
today's surprise is a minutes-long Docker build you didn't ask for, v2's is a
one-line "langy is off here — `haven up +langy`" when you actually need it.

Sticky selection introduces a small state file, which is one more thing that
can be stale — mitigated by `status` always showing the resolved selection
and `up` printing it on every start.

Per-service log capture costs disk and a small supervisor change; capped
files bound the disk, and it is the enabler for the entire no-hoops logs
story, including post-mortem reads after a crash.

**Amendment 2026-10-10.** Grouping the simulators, the observability tabs and
the orb under nouns makes the top level longer to type for those tools but
lets an agent learn one vocabulary instead of ten. Moving the hub off bare
`haven` costs humans one word and removes the one invocation an agent could
only fail on. Versioned JSON, field selection and distinct exit codes cost
schema upkeep; they buy an agent that can branch on what went wrong without
parsing prose. The clean break costs every skill and script one sweep, done in
the implementing PR, instead of a compatibility layer that never goes away.

## Consequences

- `cmd/root.go`'s hand-rolled dispatch, alias table, and ad-hoc flag parsing
  are replaced by a declarative command table that enforces the rules
  (single names, registered flags, shorthand uniqueness) at build time.
- The README's command reference shrinks to the table above and is rewritten
  with the implementation, not before.
- `specs/setup/haven-lifecycle-usability.feature` is updated by this change
  (up-reconciles replaces up-refuses; `down --drop-db` is removed);
  `haven-cli-surface.feature`, `haven-service-selection.feature`,
  `haven-automatic-prep.feature`, and `haven-logs.feature` are new and
  normative.
- `make haven <cmd>` passthrough and the boxd/quickstart
  docs are updated to the new spellings in the same change.
- Anyone's shell history breaks once, with a pointer.
- Amendment 2026-10-10: the command table gains groups (`sim`, `obs`,
  `orb`, `db`, `machine`, `self`), the retired-spelling map gains every row of
  the old -> new table, and help is grouped. Skills, `LOCAL_STACK.md`, the
  haven README, `make haven` and repo scripts move to the new spellings in the
  same PR. `specs/setup/haven-cli-surface.feature` carries the amendment's
  rules; its scenarios marked "v2, bound" pin today's behaviour until that PR
  rewrites them.

## References

- Related ADRs: ADR-004 (docker dev environment, and its in-process workers
  amendment), ADR-090 and ADR-091 (machine gate, `run`, `slot`), ADR-168
  (reloads; why `hmr` is gone)
- Specs: `specs/setup/haven-cli-surface.feature` (rewritten for the amendment),
  `specs/setup/haven-service-selection.feature`,
  `specs/setup/haven-automatic-prep.feature`,
  `specs/setup/haven-logs.feature`,
  `specs/setup/haven-lifecycle-usability.feature`
- Full CLI inventory that motivated this: 23 commands / 11 alias sets /
  3 meanings of `--force` / 4 status surfaces / 6 database-drop paths, as of
  `tools/thuishaven` at the time of writing.
