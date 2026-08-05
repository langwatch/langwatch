# Plan: per-worktree private Redis with a 20-min idle linger

Scoping document (not yet implemented) for `tools/thuishaven` (binary
`cmd/haven`). Citations are `file:line` under `tools/thuishaven/` unless noted.
This is the **shared prerequisite** `specs/setup/haven-try-pr-plan.md` depends on
(Redis is always private in `haven pr`).

## Goal & why

The product is event-sourced (BullMQ queues, GroupQueue streams, fold caches on
Redis). Today every worktree shares **one** brew Redis, isolated only by
`REDIS_DB_INDEX` 0-15 hashed from the slug (`domain/slug.go:73-79`, emitted at
`domain/overlay.go:63`). That's not real isolation: two worktrees can hash to the
same DB index, and a `FLUSHDB`/`FLUSHALL` in one nukes another. This overturns
ADR-004's "Redis is a singleton… parallel worktrees reuse the same instance"
(`dev/docs/adr/004-docker-dev-environment.md:156`).

**Change:** each worktree gets its own private `redis-server` on its own loopback
port + data dir, `REDIS_DB_INDEX=0`. On `down` the instance **lingers ~20 min**
(a quick down→up reuses the still-running process, keeping event-sourcing state),
then the daemon reaps it.

## Load-bearing facts (that shape the design)

1. **The stack registry entry is deleted the moment the launcher exits** — `Up`'s
   `defer cleanup()` calls `store.RemoveStack(slug)` when `Supervise` returns on
   Ctrl-C (`app/orchestrator.go:144-149,206,227`); `haven down` does the same
   (`:281`). So the daemon **cannot** use `<home>/registry/<slug>.json` to find a
   lingering redis — it's already gone. The private instance needs its **own**
   persisted record.
2. The reaper fires on **dead launcher OR stale heartbeat** (`app/daemon.go:126-127`).
   A lingering redis must **not** key off stale-heartbeat (while up, the heartbeat
   is fresh; and "redis unused while up" is explicitly *not* what we detect). The
   linger is purely "keep it 20 min **after down**", so the trigger is
   **launcher-liveness + a 20-min grace**, not heartbeat staleness.
3. `System.SpawnDetached` (`app/ports.go:87`, `adapters/system/system.go:63-86`)
   is the one primitive that makes a child (`Setsid`, `Process.Release()`)
   **outlive** Ctrl-C — exactly what a lingering redis needs (a `procsupervisor`
   child is SIGTERM'd on ctx-cancel, `adapters/procsupervisor/supervisor.go:144`).
4. `clickhousedocker` already persists a chosen host port in
   `<home>/clickhouse/endpoint.json` and reuses it across restarts
   (`adapters/clickhousedocker/server.go:43-58,183-214`) — the template for a
   per-slug persisted record, but there's no existing *separate-instance-per-slug*
   adapter; that part is genuinely new.

## Design

### 1. Interface change (`app/ports.go:148-161`) — make Redis per-slug

```go
type Redis interface {
    Ensure(ctx context.Context, slug string) (port int, err error) // spawn/reuse private instance
    Port(slug string) int                                          // no-start probe
    Running(slug string) bool
    Health(ctx context.Context) (ok bool, detail string)           // aggregate for `haven doctor`
    Stop(slug string)                                              // kill now + remove record/data dir
    ReapIdle(ctx context.Context, liveSlugs map[string]bool, ttl time.Duration) // daemon-driven
}
```

Call sites: `provision` sets `RedisDB: 0` (drop `RedisDBForSlug`,
`orchestrator.go:99`); `ensureRedis` (`:357-375`) → `Ensure(ctx, st.Slug)`;
`Doctor` (`report.go:74-76`) → aggregate Health; `wire()` (`cmd/root.go:120`) →
`redisprivate.New(havenHome(), sys)`. `app.New(...)` signature unchanged.

### 2. New adapter `adapters/redisprivate/server.go`

Owns `<home>/redis/`. `New(havenHome, sys)` takes the concrete `system.System`
(adapter→adapter). Per-slug record `<home>/redis/<slug>/instance.json`
(`{Slug, Port, PID, DataDir, StartedAt, LastActiveAt}`).

- `Ensure(ctx, slug)`: if the record's PID is alive and pings → **reuse** (the
  down→up-within-window path that preserves state); else `FreePorts(1)` (persist),
  `mkdir data`, `SpawnDetached(["redis-server", ...], dir, redis.log)`, poll-ping
  ready, write record. Flags: `--port <p> --bind 127.0.0.1 --dir <dir>/data
  --save "" --appendonly no --daemonize no --maxmemory <cap> --maxmemory-policy
  noeviction` (no disk snapshots — the linger keeps state in the live process;
  noeviction so queue keys are never dropped). Friendly `brew install redis` error
  if `redis-server` is not on PATH.
- `Stop(slug)`: `Terminate(PID)` (SIGTERM, SIGKILL fallback) + remove data dir +
  record. `ReapIdle`: for each record, if `liveSlugs[slug]` refresh
  `LastActiveAt`; else if `now-LastActiveAt > ttl` → `Stop`; dead-PID orphans
  cleaned immediately.

**Port is owned/persisted by the adapter** (not `provision`'s `FreePorts`), so
`REDIS_URL` and the process are stable across down→up.

### 3. Overlay (`domain/overlay.go`) — values only, no structural change

`REDIS_URL=redis://127.0.0.1:<privatePort>` (already emitted from `s.RedisPort`,
`:112`); `REDIS_DB_INDEX=0` (already from `s.RedisDB`, `:63`, now 0).

### 4. Lifecycle / reaper

Spawn via `SpawnDetached` (survives launcher). Track in the adapter's own record
(survives launcher exit). Reap in the daemon's `monitorLoop`: compute `liveSlugs`
from the `ProcessAlive(LauncherPID)` scan it already does, call
`o.rds.ReapIdle(ctx, liveSlugs, cfg.RedisIdleTTL)` each 10s cycle (beside
`reapClickHouse`). `down` does **nothing** to redis; add `haven down --drop-redis`
as the explicit "nuke my queue state now" escape hatch.

### 5. Phased breakdown

- **Phase 1 — unique instance, dies on `down`.** Build the adapter + interface +
  call sites + overlay values + `RedisDB=0`; wire `Up`'s cleanup to
  `o.rds.Stop(slug)`. Delivers real per-worktree isolation immediately; **defers**
  the linger (each down→up starts fresh, losing event-sourcing state — a
  documented gap). Recommended spawn path: spawn-in-`Ensure` + cleanup-`Stop` (same
  adapter code across phases; only the cleanup wiring flips in Phase 2).
- **Phase 2 — detach + daemon-reap for the 20-min linger.** Remove the cleanup
  `Stop`; add `Config.RedisIdleTTL` + `HAVEN_REDIS_IDLE_TTL` (default 20m);
  `monitorLoop` → `ReapIdle`; `Ensure` reuse path returns the running instance;
  `--drop-redis` flag.

### 6. Risks

- **Orphaned processes / port leaks** if the daemon is down — mitigated by daemon
  re-spawn on every `up` + `Ensure`/`ReapIdle`/`haven prune` reconciling dead-PID
  records.
- **State lost if reaped too early** — 20m must exceed a normal down→up; tunable;
  Phase 1 loses state each down (call it out).
- **`redis-server` not on PATH** — friendly error, non-fatal (fall back to `.env`
  REDIS_URL like the other `ensure*`).
- **N worktrees ⇒ N redis processes** — bound each with `--maxmemory` (~256-512MB);
  doctor surfaces the count.
- **Heartbeat ≠ real idle** — resolved by keying reap on launcher-liveness + grace,
  not stale-heartbeat.

### 7. Specs / ADRs

No thuishaven ADR exists yet. **Write** `dev/docs/adr/049-haven-worktree-isolation.md`
(the first thuishaven ADR: hostname routing + per-slug DB isolation +
private-Redis-with-linger), cross-linking ADR-004's worktree-isolation amendment
(`:152-156`) and ADR-006 (redis queue-keyspace). **Write**
`specs/setup/haven-private-redis.feature` (scenarios: each worktree gets its own
redis; down→up within 20 min keeps queued jobs; idle past 20 min is reaped; two
worktrees never share a keyspace; missing `redis-server` warns + falls back).
Update `CLAUDE.md`'s haven blurb (the "partitioned by REDIS_DB_INDEX" mental model
goes stale).

## Files touched (summary)

New: `adapters/redisprivate/server.go` (+test), the ADR, the feature.
Changed: `app/ports.go`, `app/orchestrator.go` (provision/ensureRedis/Up-cleanup/Down),
`app/daemon.go`, `app/config.go`, `app/report.go`, `cmd/root.go`,
`domain/overlay.go` (values), `domain/redis.go`, `domain/slug.go` (drop
`RedisDBForSlug`), display readers of `Stack.RedisDB`.
Removed: `adapters/redisbrew/` (or demoted to an opt-out).
