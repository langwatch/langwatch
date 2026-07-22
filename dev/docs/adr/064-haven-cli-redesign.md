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
   means the same thing on every command that accepts it. `-f` is `--follow`
   and nothing else. `--force` does not exist; non-interactive confirmation
   of a destructive action is always `--yes`. `--json` and `--agent` are
   global. `--rebuild` means "rebuild the image" wherever it appears.
3. **`up` is declarative and idempotent.** `haven up` means "make this
   worktree's stack match its service selection". Not running → start.
   Already running → reconcile (bounce only what changed). There is no
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

```
haven                 the hub: every stack, health, RAM, actions (agents/pipes get plain status)
haven up [+svc|-svc]  start or reconcile this worktree's stack; selection deltas stick
haven down [--all]    stop this stack, keep all data; --all stops every stack + shared servers
haven restart [svc] [--rebuild]   bounce one service or all; --rebuild re-images container services
haven logs [svc…] [-f] [--since 10m] [--level warn] [--stack slug]
haven status [--json] one-shot: selection, service health, shared-server health, RAM (absorbs list+doctor)
```

Data and cleanup (the only destructive nouns):

```
haven db reset [--demo] [--yes]   fresh migrated+seeded databases for this stack
haven db url [postgres|clickhouse|redis]   connection strings
haven clean [--yes]   one interactive cleanup: worktrees, artifacts, idle DBs, orphan processes
```

Workflow tier, unchanged in behaviour but de-aliased:

```
haven pr <ref>        try a GitHub PR in a fresh worktree (--force renamed --allow-closed)
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

```
haven up +langy       add langy to this worktree's stack, now and from now on
haven up -nlp         stop running nlp here; the hostname falls back to the shared baseline
haven up              whatever this worktree last selected
```

The selection lives in a small worktree-local file (`.haven.json`, gitignored,
next to `.langwatch-slug`), is printed by `status` and the hub, and survives
terminals, reboots, and detach. `up` on a running stack reconciles the delta —
adding `+langy` to a live stack starts exactly langy.

**Defaults flip to lean.** A fresh worktree runs `app` (workers in-process),
`nlp`, and `gateway` — and *not* `langy`. langy costs a container image and a
1.8 GB memory cap that most worktrees never exercise; the worktrees that need
it say `+langy` once. The first `up` prints the selection and how to change
it, so the lean default is discoverable rather than mysterious.

The legacy selection env vars (`LANGWATCH_SKIP_*`, `START_WORKERS`,
`WORKERS_IN_PROCESS`) are honoured for one release as *one-shot, non-sticky*
overrides that print the sticky equivalent, then removed. Repo scripts
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
- `-f` follows; `--since 10m` windows; `--level warn` filters structured
  lines by severity; `--stack <slug>` reads another worktree's stack;
  `--json` emits raw lines for tooling.
- Logs outlive the stack: after `down` (or a crash) the last run's logs are
  still readable — which is precisely when you want them.
- `obs` is a valid log target (replacing `make observability-logs`).

### What is cut, and where it went

| Today | v2 |
|---|---|
| `setup` | automatic preflight of `up` |
| `list` / `ls` / `status`-alias, `doctor`, `watch` | `haven status` (one-shot) and the bare-`haven` hub |
| `hub` / `ps` / `active` | bare `haven` only |
| `up -f/--force` | `up` reconciles; the dance is gone |
| `up -w/--watch` | unchanged flag, only meaning of `--watch` |
| `down --drop-db` / `--keep-db` | `down` keeps data, always; fresh data is `haven db reset` |
| `clickhouse` / `ch`, `postgres` / `pg` subtrees | `haven db url`, `haven db reset`; server lifecycle is automatic |
| `observability` / `obs` subtree | managed automatically; `restart obs`, `logs obs`, `status` |
| `seed [--preset demo]` | `haven db reset [--demo]` |
| `prune`, `prune --artifacts`, `cleanup` / `oc` | `haven clean` (one interactive picker, categories: worktrees, artifacts, idle DBs, orphan processes) |
| `pr --trusted` / `--allow-scripts`, `pr --force` | `--allow-scripts` only; `--allow-closed` |
| `hmr pause` / `resume` | `hmr on` / `off` only |
| `git --list` vs `switch --list` divergence | `--json` on `git`; `switch --list` stays (completion) |
| selection env vars | sticky `up +svc` / `-svc` (one-release warning bridge) |
| `HAVEN_LANGY_REBUILD` | content-hashed images + `--rebuild` |

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
