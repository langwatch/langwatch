# Langy worker cold-start + liveness plan

Working plan on `feat/langy-rework`. Written to survive a context compaction —
everything needed to execute is here. Companion to the in-flight observability work
(a subagent is adding per-turn lifecycle spans; see **Coordination** below).

## Target & priority (hard requirement)

**A worker must be ready in ~1 second.** 90s (the current liveness give-up) is not a
budget to tune — it must never be reached because warm-up is ~1s. Priority order:

1. **Fix A — kill the per-spawn npm fetch** (minutes → seconds). This is THE fix.
2. **Warm-ahead — spawn before the user sends** (seconds → ~0 perceived). Today the
   worker is warmed fire-and-forget **at turn-start** (`langy-turn.service.ts:388
   void worker.warm(...)`), so the FIRST message eats the whole cold spawn. Trigger
   `/warm` earlier — on Langy panel open / composer focus / conversation select — so a
   ready worker exists by the time they hit send. The `/warm` path already exists
   (`app.App.Warm`, `POST /warm`); this is mostly a client-side call-it-sooner + a
   guard so we don't warm on every keystroke.
3. **Fix B — liveness warm-up keep-alive** — safety net only, once A+2 land.

Even after Fix A, raw opencode boot (Node/Bun HTTP server, `WaitForReadiness` in
`agent.go`) has a floor of ~1–2s; **warm-ahead is what hides that floor** to hit ~1s
perceived. If the floor is still too high after Fix A, measure opencode boot in
isolation (the new `worker.ready` span) and consider a **standing warm pool** (keep 1
ready worker per active conversation, or a small shared idle pool) as the last lever.

## Symptoms (observed, live stack `langy-rebase`)

- A Langy turn shows "starting up" for minutes, then "Reconnecting to the agent…",
  then (eventually) the "Langy's worker stopped before it could finish" card.
- Measured from `langyagent` logs on one turn: worker active ~401s with **99s**
  and **227s** silent gaps, all egress to `registry.npmjs.org`.

## Root causes (both confirmed by reading the code)

### A. Cold-start cost = opencode re-fetching its OTel plugin from npm per worker
- Each worker's `config.json` sets `"plugin": ["@devtheops/opencode-plugin-otel@<ver>"]`
  (`services/langyagent/adapters/opencode/provision.go` ~line 107/120-136).
- opencode boots with `HOME=<per-worker home>` (`buildWorkerEnv`, provision.go),
  and **auto-loads the plugin by name, resolving from the per-worker home** — which
  is created fresh every spawn (`Provision`), so there is no warm node_modules / bun
  cache and opencode **fetches from npm** (the registry.npmjs.org egress, minutes).
- The plugin **is** baked into the image — `Dockerfile.langyagent:244`
  `RUN npm install -g "@devtheops/opencode-plugin-otel@${OPENCODE_OTEL_PLUGIN_VERSION}"`
  with the comment "so the pinned version is present in the image [to avoid]
  opencode's runtime fetch." **But `-g` puts it in the global npm prefix, which
  opencode (per-worker `HOME`, running on Bun) does not resolve from — so the bake
  is ineffective and it re-fetches anyway.**
- **Local vs secure:** the local haven image is built from the *same*
  `Dockerfile.langyagent` (`tools/thuishaven/app/plan_langy.go:152`
  `docker build -f Dockerfile.langyagent -t langyagent:dev .`), and prod uses it via
  `charts/langyagent`. So **this happens in prod too** — every cold worker pays the
  npm fetch. Fixing the bake location fixes both at once.
- Skills are NOT part of this cost: they are materialized once from embedded assets
  and symlinked read-only into each worker home (provision.go ~170-184). Only the
  plugin fetch is the problem.

### B. Liveness gives up during a legitimately-slow warm-up (false-positive "stopped")
- Liveness is a Redis TTL heartbeat key `langy:hb:{conv}:{turn}`
  (`langwatch/src/server/app-layer/langy/streaming/langyTokenBuffer.ts`:
  `heartbeat()` refresh, `liveness()` staleness; grace = `HEARTBEAT_GRACE_MS` 30s,
  give-up = `MAX_STALL_MS = 30s×3 = 90s` in `agentTurnLiveness.reactor.ts`).
- The heartbeat is refreshed by the relay on each frame
  (`langyTurnRelay.ts:240 buffer.heartbeat(at)`), and the Go worker only emits
  `frames.Heartbeat` **once the opencode stream is running** (opencode.go ~774,
  every `progressInterval` < 30s).
- **During spawn/WaitReady (the cold-start), nothing emits heartbeat or progress
  frames**, so the key goes stale and a 99s/227s install gap trips the 90s give-up
  → the turn is failed as "worker stopped" even though the worker is alive and
  installing. The "Reconnecting…" is the reactor's re-drive; the card is the final
  give-up.

## Fix A — make the baked plugin actually resolvable (kill the npm fetch)

Goal: a fresh worker resolves `@devtheops/opencode-plugin-otel@<ver>` with **zero
network**, in both local and prod images.

Steps:
1. **Confirm opencode's plugin resolution path** (small spike, do first). Options to
   determine WHERE opencode looks: read opencode's plugin loader for its
   HOME/bun-cache layout, or observe a live worker (the running container:
   `docker exec langyagent-langy-rebase ...`) — e.g. strace/ls the worker home after
   a spawn to see whether it writes `~/.config/opencode/node_modules`, a bun cache
   under `TMPDIR`, or `~/.cache/...`. This determines which mechanism below to use.
2. **Pre-warm the resolution target at build time.** Most likely one of:
   - (preferred, mirrors skills) install the plugin into a **shared read-only dir**
     baked in the image (e.g. `/opt/langy/opencode-plugins/node_modules/...`), then
     have `Provision` symlink/copy it into the per-worker home's plugin path
     (extend provision.go the same way skills are linked), **or**
   - point opencode/bun at a **pre-populated cache** via env (e.g. `BUN_INSTALL_CACHE`
     / opencode's plugin-dir env) set in `buildWorkerEnv`, with the cache baked in the
     image and mounted read-only, **or**
   - if opencode honors the global prefix via `NODE_PATH`, set `NODE_PATH` to the
     global install in `buildWorkerEnv` (cheapest if it works).
3. **Dockerfile.langyagent:** change line 244 from `npm install -g` to install into
   whichever location step 1 proved opencode resolves (keep the pin + sha discipline).
4. **Verify:** spawn a worker with egress monitoring; assert **no** request to
   `registry.npmjs.org` for the plugin, and `WaitReady` drops from minutes to seconds.
   Add/extend `provision_test.go` for the new link/env.

Fallback if opencode insists on a network check even with a warm cache: run its
plugin install **once at image build into a template home**, and have `Provision`
`cp -a` that template home as the worker home base (still no per-spawn network).

## Fix B — cover the warm-up window so liveness doesn't false-positive

Goal: from dispatch to first token, the turn stays "alive" and the UI shows honest
warm-up status; a genuinely dead spawn still fails (just not a slow one).

Steps (Go, `services/langyagent`):
1. During spawn/WaitReady (`app/workerpool/pool.go` spawnInner, the same phase the
   observability spans wrap), **emit periodic keep-alive + a "warming" progress
   frame** through the existing signed-frame path (`frames.Heartbeat` +
   a status/progress frame like "Setting up the workspace…"/"Installing skills…"),
   at `progressInterval` cadence, until the opencode stream takes over. This refreshes
   the Redis heartbeat key (via the relay) so the 90s give-up doesn't trip, AND makes
   the thinking line show real warm-up state instead of escalating to "stuck".
2. Ensure the warm-up keep-alive **stops** the moment real frames flow (no double
   heartbeat) and on spawn failure (so a truly failed spawn still goes terminal fast).
3. Optional (only if Fix A doesn't get warm-up under ~30s): give the pre-first-token
   phase a **larger budget** than `MAX_STALL_MS` — e.g. a separate
   `SPAWN_STALL_MS` in `langy.streaming.constants.ts` used by the liveness reactor
   while `CurrentTurnId` is unset / before `agent_response_started`. Prefer #1 over #3;
   a heartbeat during warm-up is more honest than a bigger blind timeout.

Note: with Fix A landing warm-up in seconds, Fix B is mostly a safety net + honest UI
status; keep it small.

## Files (expected)

- Fix A: `Dockerfile.langyagent`, `services/langyagent/adapters/opencode/provision.go`
  (+ `buildWorkerEnv`), maybe `app/workerpool/pool.go` (WorkspaceRoot materialize),
  `provision_test.go`. Possibly a haven note for the `langyagent:dev` rebuild.
- Fix B: `services/langyagent/app/workerpool/pool.go`,
  `services/langyagent/adapters/opencode/opencode.go` (frame emission),
  maybe `langwatch/.../langy.streaming.constants.ts` (only if adding SPAWN_STALL_MS)
  and `agentTurnLiveness.reactor.ts`.

## Coordination (IMPORTANT)

A subagent is concurrently adding **observability** (OTEL env for the container in
`plan_langy.go`; `await import("./instrumentation.node")` in `server.mts`; per-turn
lifecycle spans in `pool.go` spawnInner / `opencode.go` / `app.go` / `telemetry.go`).
Fix A and Fix B touch some of the SAME Go files (spawnInner, opencode.go, provision).
**Do Fix A/B AFTER the subagent's observability pass lands** (or hand A/B to that
subagent so one worktree owns the langyagent Go changes) to avoid collisions. The
lifecycle spans are also what will *prove* Fix A worked (the `worker.ready` bar should
collapse from minutes to seconds).

## Verification (end to end)

1. `go build ./...` + `pnpm typecheck` clean.
2. One `haven down/up` (from the `langy-rebase` worktree — `make haven down` then
   `make haven up`; it drops+reseeds the stack DBs, expected).
3. Send a Langy turn on a COLD worker; confirm via egress/logs (or the new spans in
   Grafana) that there is **no npm plugin fetch** and `worker.ready` is seconds.
4. Confirm the UI shows continuous warm-up status (no blank, no premature
   "worker stopped") — this is the invariant fix already landed
   (`isTurnInFlight` = fold `active||running`, in `LangyPanel.tsx` + `langy.ts` +
   `useLangyMessages.ts`).

## Already landed on the branch (context)

- UI invariant fix: durable `isTurnInFlight` (`active||running`) gates the working
  line so the column is never blank between send and terminal.
- Observability pipeline fixes in flight (subagent): container OTEL env + API OTel
  bootstrap + lifecycle spans.
