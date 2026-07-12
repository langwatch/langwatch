# Plan: `haven pr <PR>` — one-command "try this PR locally"

Scoping document (not yet implemented). Citations are `file:line` under
`tools/thuishaven/` unless noted.

## Problem & how it differs from boxd

Trying a teammate's PR locally today is a manual chore: `git fetch`, `git
worktree add`, copy `.env`s, `pnpm install`, regen Prisma/Zod, migrate, seed,
start — then remember to tear it down. `scripts/worktree.sh` automates the
*issue→worktree→install* half (`scripts/worktree.sh:84-122`) but stops before
env-wiring and launch and knows nothing about hostnames, DB isolation, or
reaping.

haven already owns everything downstream of "a worktree exists": slug
derivation, hostname routing, per-slug ClickHouse/Postgres databases, the seeded
identity, the overlay env file, process supervision, and a daemon that reaps dead
stacks. **`haven pr` is the missing front-half** — resolve a PR to a worktree —
bolted onto haven's existing `up` back-half, plus a throwaway-teardown story.

**vs boxd** (`dev/docs/boxd-makefile.md`): boxd forks a *cloud VM* from a golden
image — durable, shareable, production-shaped, minutes to provision. `haven pr`
is the opposite end: **local native processes, seconds to a hostname, disposable**
— reuses your warm pnpm store, already-running shared Postgres/ClickHouse, and
local colima VM, and self-destructs on idle. Use `haven pr` to glance at a PR's
behaviour in your browser right now; use boxd when you need an isolated machine
that outlives your terminal. Complementary, not competing.

## CLI surface

```
haven pr <number | github-url> [-p] [-c] [--keep] [--no-install]

Resolve a GitHub PR to a git worktree, wire its env, and bring the stack up on a
hostname. Redis is ALWAYS a private, per-PR instance (see haven-private-redis).
Postgres and ClickHouse default to the shared managed servers (a fresh per-PR
database on each); -p / -c upgrade those to fully isolated per-PR instances.

  -p, --isolate-postgres     own Postgres instance, not just a database
  -c, --isolate-clickhouse   own ClickHouse instance
  -pc / -p -c                both (order-independent)
  --keep                     do not auto-reap this worktree on idle/exit
  --no-install               skip pnpm install (deps already present)
```

**Flag-ambiguity resolution.** The original sketch had `-p` = "unique
Postgres-clickhouse" and `-pc` = "unique clickhouse and Postgres" — the same
thing twice. Clean fix: **one letter per backend, freely composable** — `p`=
Postgres, `c`=ClickHouse; Redis is implicitly always-private so it needs no
letter. `-pc` == `-cp`, no separate combined spelling to keep in sync. Accept
`-r` as a documented no-op alias ("private Redis only, shared PG/CH") so the
original mental model maps cleanly.

| Flag | Postgres | ClickHouse | Redis |
|------|----------|-----------|-------|
| *(none)* | shared server, per-PR DB `lw_pr_<n>` | shared server, per-PR DB | **private instance** |
| `-p` | **private instance** | shared, per-PR DB | **private instance** |
| `-c` | shared, per-PR DB | **private instance** | **private instance** |
| `-pc` | **private instance** | **private instance** | **private instance** |

## Execution flow (reuses `haven up` wholesale)

Key insight: `wire()` (`cmd/root.go:96-156`) derives *everything* (worktree dir,
lwDir, branch, slug, IsLinkedWorktree) from `os.Getwd()`. So once the PR worktree
exists, running `haven up` **with cwd set to that worktree** reuses the entire
provision→codegen→migrate→seed→supervise pipeline with zero refactor.

1. **Resolve the PR** (new). Parse a bare number or `github.com/.../pull/N` URL,
   then `gh pr view <N> --repo langwatch/langwatch --json headRefName,headRefOid,isCrossRepository,...`.
   `gh` is already a documented prereq, used at `scripts/worktree.sh:86-92` and
   `scripts/boxd-fork.sh:468-487`. Refuse a non-OPEN PR unless `--force`.
2. **Create/reuse the worktree** (new). First check `Hygiene.Worktrees(repoRoot)`
   (`adapters/hygiene/hygiene.go:25-51`) — if the branch is already checked out
   (e.g. `worktrees/pr-5015` exists), skip the add and just `up` there. Otherwise
   place it at `<worktreesBase>/pr-<N>` (the sibling `worktrees/` dir, overridable
   via `HAVEN_WORKTREE_DIR`); the dir name makes the slug deterministically
   `pr-<n>` → `app.pr-<n>.langwatch.localhost`. Same-repo: `git fetch origin
   <headRefName>` + `git worktree add`. **Fork/cross-repo**: `git fetch origin
   pull/<N>/head:pr-<N>` then add — no fork remote needed. Copy `.env`s via the
   drift-aware copier in `scripts/worktree.sh:124-186` (reuse, don't reimplement).
3. **Install deps** (reuse Supervisor). `pnpm install` in the worktree via
   `Supervisor.RunOnce` (`app/ports.go:56-61`, the one-shot mechanism `Up` already
   uses at `orchestrator.go:214-226`). Skippable with `--no-install`. pnpm's
   content-addressed store is shared across worktrees → mostly hardlinks on a warm
   store.
4. **Env + up** (reuse `Up` verbatim). Set isolation intent as env
   (`LANGWATCH_HAVEN_REDIS_PRIVATE=1` always; `-p`→`LANGWATCH_HAVEN_PG_PRIVATE=1`,
   `-c`→`LANGWATCH_HAVEN_CH_PRIVATE=1`; `HAVEN_EPHEMERAL=1` + `HAVEN_PR_NUMBER=<N>`)
   and invoke `haven up` with cwd = the worktree. `Up` then does provision (slug,
   ports, hostnames, ensure CH/PG/Redis, write `.env.portless`, heartbeat) →
   codegen/migrate/seed one-shots (`orchestrator.go:214-226`) → supervise the
   lanes → print the banner — all unchanged.

## Isolation design

"Unique/private" means a **separate server process**, not just a separate DB on
the shared one. Today haven does "shared server, DB per slug": ClickHouse
`lw_<slug>` on one container (`orchestrator.go:291-316`), Postgres `lw_<slug>` on
one brew server (`:323-350`), Redis partitioned only by `REDIS_DB_INDEX`
(`domain/slug.go:73-79`, `overlay.go:63`).

- **Private Redis (always).** The 16-slot DB-index scheme isn't real isolation
  (two PRs can hash to the same index; a FLUSHALL nukes both). This is the shared
  prerequisite — see the companion **haven-private-redis** plan. `overlay.go`
  already emits `REDIS_URL=redis://127.0.0.1:<port>`, so a private port + DB 0
  needs no overlay change beyond the value.
- **Private Postgres (`-p`)** / **Private ClickHouse (`-c`)**: new adapters
  (`adapters/postgresprivate`, per-slug `clickhousedocker`) that implement the
  existing `app.Postgres` / `app.ClickHouse` ports; the composition root
  (`wire()`, `cmd/root.go:118-120`) chooses which to inject based on the
  `*_PRIVATE` env. Overlay URL emission already handles arbitrary ports. Cost is
  real (a whole postmaster / another 1.5 GiB ClickHouse cap), so these are opt-in.

## Reaping

The daemon's `monitorLoop` (`app/daemon.go:108-144`) already reaps stacks on
dead-PID or stale heartbeat (`IdleTTL` default 4h, `cmd/root.go`). Extend for
**ephemeral** stacks: add `Ephemeral`/`PRNumber` to `domain.Stack`, a shorter
`EphemeralIdleTTL` (~20 min, `HAVEN_EPHEMERAL_IDLE_TTL`), and on reap additionally
`Stop()` private instances and `git worktree remove --force <dir>` **only if not
dirty** (`Hygiene.Dirty`, `hygiene.go:54-60`) — never delete uncommitted work.
`--keep` opts out. Closing the terminal → dead-PID reap within one monitor cycle.

## Phased implementation

- **Phase 0 — spec + ADR.** There is NO thuishaven ADR/spec yet (the
  `dev/haven.mk:1` "ADR-048" ref is a stale/colliding number). Write
  `specs/setup/haven-try-pr.feature` (style per
  `specs/setup/quickstart-entry-point.feature`) and the first thuishaven ADR,
  cross-linking ADR-004's worktree-isolation amendments.
- **Phase 1 — MVP.** `app/pr.go` `TryPR`: resolve → worktree → install →
  foreground `haven up`. Depends on the private-Redis adapter (Phase 1 of the
  companion plan). Command wiring is ~2 lines: one entry in the `commands` map
  (`cmd/root.go:163-197`) + a `cmd/help.go` block; `make haven pr 4913` already
  forwards through `dev/haven.mk:37-58`. Ships the golden path.
- **Phase 2 — `-p`/`-c` isolation flags** (private PG/CH adapters).
- **Phase 3 — ephemeral reaping** (Stack.Ephemeral, short TTL, worktree removal).

## Risks / open questions

- **"Seconds" is warm-cache only.** First-ever worktree pays `pnpm install` (cold:
  minutes) + `start:prepare:files` codegen + first migration. Rely on pnpm's
  shared store; `--no-install` when deps exist; set expectations in the banner.
- **Private-repo/fork auth** — delegated to the user's `gh`/git creds; fork PRs
  fetch `pull/N/head`; friendly "run `gh auth login`" on 401/403.
- **Collision with an already-checked-out PR** — detect via `Hygiene.Worktrees`
  and reuse rather than fail on `git worktree add`'s "already checked out".
- **Reaping a dirty PR worktree** — never remove one with uncommitted changes.
- **Memory blow-up with many `-c`/`-p` PRs** — each private CH is another 1.5 GiB
  cap; consider bounding concurrent isolated instances via the existing
  `Semaphore` (`app/ports.go`).
- **True idle detection** — heartbeat proves the launcher is alive, not that the
  PR is *used*. MVP runs `haven pr` in the foreground so closing the terminal is
  the reap trigger; detached + activity-based idle is a later phase (co-developed
  with private-Redis idle work).

## Cross-links

- Depends on **haven-private-redis** (Redis is always private here).
- Extend `dev/docs/adr/004-docker-dev-environment.md` (worktree isolation,
  stateful volumes, in-process workers amendments).
- Reference `dev/docs/boxd-makefile.md` (local-vs-cloud complementarity) and
  `tools/thuishaven/README.md` "Forward ideas" (this ships two of them).
- Ruled out: `specs/langy/langy-github-prs-plan.md` is the *Langy agent* opening
  PRs on a user's behalf — unrelated to haven trying PRs locally.
