# ADR-064: haven CLI v2 — one name per command, one meaning per flag

**Date:** 2026-07-23

**Status:** Proposed

## Context

haven (`tools/thuishaven`) grew command-by-command, each addition locally
reasonable, with no overall constitution. A full inventory of `cmd/root.go`
shows where that ends up:

- **Multiple names for everything.** 23 top-level commands, 11 of them with
  alias sets: `hub` = `ps` = `active` (= bare `haven`), `list` = `ls` =
  `status`, `restart` = `rs`, `switch` = `sw` (= `cd` in the shell wrapper),
  `clickhouse` = `ch`, `postgres` = `pg`, `observability` = `obs`,
  `typecheck` = `tc`, `cleanup` = `oc`, `git` = `moron`. The CLI a newcomer
  reads in the README is not the CLI they see in a teammate's shell history.
- **The same letter means opposite things.** `up -f` force-replaces a running
  stack; `logs -f` follows output. `--force` itself has three unrelated
  meanings (replace the stack on `up`, allow a non-open PR on `pr`, a required
  safety confirmation on `cleanup`). `--list` means "plain overview" on `git`
  but "names only" on `switch`.
- **`status` means three things**: an alias of `list`, and the default
  subcommand of `clickhouse`, `postgres`, `observability`, and `hmr`. The two
  container command groups then disagree on their stop verb (`clickhouse
  stop` vs `observability down`; `postgres` has neither).
- **Four overlapping status surfaces** — `hub` (interactive + actions),
  `watch` (interactive, no actions), `list` (one-shot), `doctor` (health +
  footprints) — and **six ways to drop a database**: `down --drop-db`,
  `clickhouse drop`, `postgres drop`, `prune`, `prune --artifacts`, and the
  daemon's TTL prune.
- **Service selection is env-var soup.** Which services a stack runs is
  decided by ten-plus env vars with inconsistent polarity and naming
  (`LANGWATCH_SKIP_AIGATEWAY=1`, `LANGWATCH_SKIP_NLP=1`,
  `LANGWATCH_SKIP_LANGYAGENT=1`, `START_WORKERS=false`,
  `WORKERS_IN_PROCESS=0`, `LANGWATCH_HAVEN_OBS=0`, …). Nothing shows the
  current selection, and nothing records it — every terminal has to get the
  incantation right again.
- **The expensive path is the default.** `HAVEN_LANGY_REBUILD` defaults to
  rebuilding the langyagent Docker image on *every* `up` — minutes of build
  for a service many worktrees never exercise. Reusing the existing image is
  the thing you need an env var to opt into.
- **Logs have hoops.** Attached mode writes only to whichever terminal ran
  `up`; `haven logs` works only for stacks started with `-d`; there is no
  per-service filter at all. The practical fallback — grep `server.log` or
  write a gcx query — is exactly the hoop a dev tool should remove.

## Decision

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
   and nothing else. `-f` is `--force` — forcing the *lifecycle* action, and
   only on `up` (restart even a matching stack) and `down` (kill hard, no
   graceful shutdown); destructive *data* actions confirm with `--yes`,
   never `--force`. `--json` and `--agent` are global. `--rebuild` means
   "rebuild the image" wherever it appears.
3. **`up` is declarative and idempotent.** `haven up` means "make this
   worktree's stack match its service selection". Not running → start.
   Already running and matching → a friendly no-op. Selection changed →
   the stack is replaced in place with the new one. There is no
   refuse-then-`--force` dance to memorise.
4. **Everything preparatory is automatic.** Proxy install and CA trust,
   dependency install, database create/migrate/seed, database *recovery*,
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
through `LANGWATCH_DEFAULT_RETENTION_DAYS=7` in `.env.portless`; the control
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
`nlp`, and `gateway` — and *not* `langy`. langy costs a container image and a
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
(`pnpm dev:haven`, `pnpm dev:workers:haven`) are rewritten to the new flags in
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

| Today | v2 |
|---|---|
| `setup` | automatic preflight of `up` |
| `list` / `ls` / `status`-alias, `doctor`, `watch` | `haven status` (one-shot) and the bare-`haven` hub |
| `hub` / `ps` / `active` | bare `haven` only |
| `up -f/--force` | `up` reconciles; `-f` now means "restart even a matching stack" |
| `up -w/--watch` | unchanged flag, only meaning of `--watch` |
| `down --drop-db` / `--keep-db` | `down` keeps data, always; fresh data is `haven db reset` |
| `clickhouse` / `ch`, `postgres` / `pg` subtrees | `haven db url`, `haven db reset`; server lifecycle is automatic |
| `observability` / `obs` subtree | managed automatically; `restart obs`, `logs obs`, `status` |
| `seed [--preset demo]` | `haven db seed [preset]` (in place) / `haven db reset [preset]` (fresh) |
| `prune`, `prune --artifacts`, `cleanup` / `oc` | `haven clean` (one interactive picker, categories: worktrees, artifacts, idle DBs, orphan processes) |
| `pr --trusted` / `--allow-scripts`, `pr --force` | `--allow-scripts` only; `--allow-closed` |
| `hmr pause` / `resume` | `hmr on` / `off` only |
| `git --list` vs `switch --list` divergence | `--json` on `git`; `switch --list` stays (completion) |
| selection env vars | sticky `up +svc` / `-svc` (the env vars are refused, naming their replacement) |
| `HAVEN_LANGY_REBUILD` | content-hashed images + `--rebuild` |

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
  derivable, so anyone can make a commit *appear* to be a maintainer's.
  Therefore:
  - **Same-repo PR** — the branch exists in this repository, which required
    push access to create, so the code already passed a real access check.
    Every commit author and committer is checked for write access, and an
    identity with no GitHub account is untrusted by definition.
  - **Fork PR** — attribution proves nothing, so only a commit carrying a
    signature GitHub *verified*, whose verified signer has write access,
    counts as trusted. Every other commit is named as untrusted by sha.

  A listing that hits GitHub's 250-commit cap fails closed rather than
  vouching for commits it never saw. Any untrusted commit stops play: a hard
  failure in agent mode, where `--allow-untrusted` is the only way past. Not
  `--force`: that letter is lifecycle-only, and accepting untrusted code
  deserves a flag that says exactly what it does.
- **Accepting untrusted code takes two steps, not one keystroke.** In a
  terminal the gate asks twice, because the two questions are different. The
  first names the authors without write access and takes a y/N, defaulting to
  no. The second discloses the part the sandbox's isolation does *not* cover,
  then accepts only the PR's number typed back.

  That second step exists because "isolated" is easy to over-read. The
  isolation is of the PR's *data* — dedicated databases, volumes, hostnames and
  checkout, and none of the developer's `.env` files. It is not a boundary
  around the developer: the install, migrations, seed and service commands are
  ordinary child processes, so they run under the developer's own account and
  inherit the environment haven was launched from, and whatever that shell
  exports — SSH agent socket, GitHub, cloud and registry tokens — goes with
  them, alongside reachable home directory and network. Containerising the
  sandbox's *execution* would be the way to close that, and is deliberately out
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
  code with the developer's environment before any gate on the *application*
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

Spec: `specs/setup/haven-play.feature`.

## Rationale / Trade-offs

The alternative — deprecate aliases gradually, keep env vars working, add the
new commands alongside — preserves muscle memory at the cost of keeping every
confusion this ADR exists to remove, indefinitely, in a tool whose entire user
base fits in one room. We accept a one-morning break for a permanently smaller
surface.

Making `up` declarative removes the only *safety* use of `--force` (replacing
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
- `make haven <cmd>` passthrough, `pnpm dev:haven`, and the boxd/quickstart
  docs are updated to the new spellings in the same change.
- Anyone's shell history breaks once, with a pointer.

## References

- Related ADRs: ADR-004 (docker dev environment, and its in-process workers
  amendment)
- Specs: `specs/setup/haven-cli-surface.feature`,
  `specs/setup/haven-service-selection.feature`,
  `specs/setup/haven-automatic-prep.feature`,
  `specs/setup/haven-logs.feature`,
  `specs/setup/haven-lifecycle-usability.feature`
- Full CLI inventory that motivated this: 23 commands / 11 alias sets /
  3 meanings of `--force` / 4 status surfaces / 6 database-drop paths, as of
  `tools/thuishaven` at the time of writing.
