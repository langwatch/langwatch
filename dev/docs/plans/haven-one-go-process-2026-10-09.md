# Plan: one Go server app in local dev (DEV-ONE-PROCESS, Go part)

**Date:** 2026-10-09 · **Ruling:** DEV-ONE-PROCESS (Alex, round 72) · **Status:** proposed, open
questions below need Alex before slice 4.

Ruling, Go part: in local dev every haven app runs on one Go server app. The haven daemon hosts the
Go services (gateway, nlp: `service combined`) and every sim (`cmd/service/combined_dev.go`,
outboundsim too). Sim consoles (`apps/*sim-web`, `apps/haven-web`) hot-reload through Vite in dev
instead of the embedded dist. Go edits hot-reload, debounced for mass AI writes.

Read first: ADR-004 (container dev env), ADR-064 (haven CLI, daemon, launcher, lanes), ADR-168
(one-process Node dev, debounce), ADR-176 (VM-free stack, lazy dev tools, hold retired).

## 1. Today

| Process (Go)        | Scope           | Hosts                                                             | Where                                                                               |
| ------------------- | --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| haven daemon        | one per machine | hub, `<slug>` homes, telemetry fan-out, haven-web (embedded dist) | `tools/thuishaven/app/daemon.go:53` `RunDaemon`; `adapters/dashboard/console.go:18` |
| `haven up` launcher | one per stack   | the lane supervisor; its death reaps the stack                    | `tools/thuishaven/cmd/root.go:154` `procsupervisor.New`                             |
| go lane             | one per stack   | `service combined aigateway nlpgo`                                | `app/plan.go:270-292`                                                               |
| sims lane           | one per stack   | a second `service combined` with the sims                         | `app/plan.go:286-291`, `:346-351`                                                   |

- `LANGWATCH_GO_ONE_PROCESS=1` (trial, `cmd/root.go:408`) folds the sims into the go lane
  (`app/plan.go:274-278`). Default off: "a simulator under load cannot starve the gateway"
  (`app/plan.go:346-349`, `specs/setup/haven-local-topology.feature:172-176`).
- Go watch is air via `make service-watch` (`Makefile:172-199`): build then restart, a failed build
  keeps the old process, quiet window `LANGWATCH_DEV_WATCH_DEBOUNCE_MS:-750`, no max wait.
  ADR-168 measured 750 ms as never coalescing agent edits; Node moved to 2 s quiet / 30 s max wait
  (`dev/scripts/dev-supervisor.mjs:31-33`). The daemon is not watched.
- Every `make service*` builds all seven sim consoles first (`Makefile:144-148`, `:176`); each sim
  embeds `services/<sim>/web/dist` (e.g. `apps/mailsim-web/vite.config.ts:20`) through
  `pkg/webconsole.New`. Vite dev exists per console but only for working on it by hand.
- haven already links every sim, outboundsim included, for checkouts without `combined_dev.go`
  (`tools/thuishaven/cmd/bundled-simulator.go`, run as `haven simulator <name>` children).

**Defect found (blocks the default flip).** `hostBundledSimulators` places outboundsim in the
combined process (`app/plan.go:394`), but `combined_dev.go:31-47` does not link it.
`haven up +outbound` on a dev checkout runs `service combined ... outboundsim`, which fails with
`unknown service "outboundsim"` (`cmd/service/combined.go` `selectCombinedServices`) and the whole
lane exits. Today that kills the sims lane; with one process it would kill the gateway and nlp too.
The tests miss it: `everySimulator()` (`app/plan_go_simulators_test.go:42-46`) never selects
outbound.

## 2. The constraint that shapes the target

The daemon is machine-wide (`app/daemon.go:13-18`); each stack is a worktree on its own branch with
its own Go code. Go cannot load or unload code in a running process (`plugin` cannot unload, needs a
byte-identical dependency build, and is unsupported on Windows). So "the daemon hosts the Go
services" can only mean: **the daemon owns supervision, routes and logs, and runs one child per stack
built from that stack's checkout, which it rebuilds and swaps.** A literal single PID is only possible
for code that never differs per worktree (option C below), and it is the wrong trade.

## 3. Target topology

```text
haven daemon (one per machine, never restarts on a service edit)
 ├─ routes: hub, <slug> homes, telemetry, gateway.<slug>, nlp.<slug>, <sim>.<slug>
 ├─ haven-web: embedded dist, or proxied to a lazy Vite in dev
 ├─ stack A: watcher -> debounce -> go build -tags dev ./cmd/service -> swap
 │    └─ child A: service combined aigateway nlpgo idpsim mailsim ... outboundsim
 └─ stack B: same, built from B's worktree
 per sim console (dev): <sim>.<slug>/      -> lazy Vite (apps/<sim>-web), HMR over the route
                        <sim>.<slug>/api/* -> the sim inside child A
```

Per stack: one Go child instead of two (go + sims) and no air. Langy keeps its own lane (unchanged,
`app/plan_go_one_process_test.go` pins it).

## 4. Reloading without dropping the daemon's routes or state

|                                                     | A. Supervisor + rebuilt child (recommended) | B. Re-exec the daemon, listeners handed over                  | C. Daemon links the sims in-process                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon state (routes, SSE, log sinks, other stacks) | untouched by construction                   | lost unless serialised; other stacks' children orphaned       | untouched, but every sim edit needs a daemon rebuild                                                                                                          |
| Per-worktree code                                   | each stack builds its own                   | one build for all stacks: wrong code for every branch but one | sims frozen at haven's build                                                                                                                                  |
| N stacks' sims                                      | one child each                              | n/a                                                           | sims read process env (`ownAddr` -> `root(ctx, nil)`, `combined_dev.go:50-56`), so two mailsims cannot share a process without an Options-based `Run` per sim |
| Blast radius of a sim panic                         | one stack, child restarted                  | every stack                                                   | every stack and the hub                                                                                                                                       |
| Cost                                                | swap logic in haven; services unchanged     | state hand-over, re-adoption, FD passing                      | per-sim refactor, globals (OTel, clog) per instance                                                                                                           |

Recommendation: **A**. Swap is build-first: a failed build keeps the running child and the compile
error goes to the go row of `haven status` and the go log. A good build stops the old child
(SIGTERM, drain) and starts the new one on the same addresses: refused connections for well under a
second. Zero-drop listener hand-over (stdlib `exec.Cmd.ExtraFiles` + `net.FileListener`) needs every
service to accept a `net.Listener` instead of an address (`combinedService.Run(ctx, addr)`, each
sim's own `*_ADDR`); defer it until the gap is measured as a problem. B is only relevant to haven's
own code, see Q6.

## 5. Debounce

Same knobs and defaults as the Node lane (ADR-168 amendment 2026-10-09):

- Quiet window `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`, default **2000 ms** (today's Go 750 ms never
  coalesces); max wait `LANGWATCH_DEV_WATCH_MAX_WAIT_MS`, default **30000 ms**.
- Watch `*.go`, `go.mod`, `go.sum` under `cmd`, `pkg`, `services` plus `go.work`. Ignore
  `*_test.go`: tests never change the binary, and a mass test write is the common AI burst.
- One build per stack at a time. Edits during a build mark it dirty; one rebuild follows.
- Builds share the Go build cache, so an incremental rebuild is seconds; whether they queue on the
  machine slot is Q5.

## 6. Sim consoles through Vite in dev

- `pkg/webconsole` gains a dev mode in a `//go:build dev` file: when a console dev URL is injected,
  non-API paths reverse-proxy (stdlib `httputil.ReverseProxy`, WebSocket upgrade included for HMR)
  to it; `/api` stays with the sim. Release never links it.
- haven injects one dev URL per console per stack and stops running `$(BUILD_SIM_CONSOLES)` before
  every Go start when it does (`Makefile:148`, `:176`).
- The Vite servers are lazy: started on the first request, stopped after `LANGWATCH_DEV_TOOLS_IDLE`.
  Reuse the ADR-176 §5 machinery (`apps/ui/vite/dormant-dev-tool.ts`), not a new supervisor. Each
  console's `vite.config.ts` already proxies `/api` to its sim (`apps/mailsim-web/vite.config.ts:17`);
  HMR must use the routed host, copied from how `apps/ui` runs behind the proxy.
- haven-web: the daemon proxies to a lazy Vite for `apps/haven-web` when its dev URL is set; the
  embedded dist stays the default for an installed `haven`.

## 7. What release builds keep

- Product images build `./cmd/service` untagged: gateway and nlp only.
  `cmd/service/combined_release_test.go:10` (`TestReleaseBuildOffersNoSimulator`) stays the guard.
- The swap supervisor and watcher live in `tools/thuishaven` only; haven is never shipped in the
  product image. The webconsole dev proxy is `dev`-tagged. Embedded dists stay for sims run outside
  haven and for `haven simulator` bundled copies.

## 8. Failure isolation (why today splits)

One process shares the scheduler (preemptive, so CPU is shared rather than starved), the GC (a
sim's allocation rate adds GC assist latency to gateway requests: the real cost) and the heap (a sim
leak OOMs the gateway; sims keep bounded history, `sims` skill "Load runs" step 4). Panics:
`runCombinedService` recovers only each service's `Run` goroutine and `net/http` recovers handler
panics; a panic in any other goroutine a sim starts ends the child.

Mitigations, in the plan: the supervisor restarts a crashed child with backoff (a dev outage of
seconds); the split stays one variable away (`LANGWATCH_GO_ONE_PROCESS=0` keeps two children) and
the sims skill's load-run steps tell you to set it. Dev gateway latency is not a measured SLO.

## 9. Slices, in order

| #   | Slice                                                                                                                                                                                                                                                               | Owner                 | Tests                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Link outboundsim in `combined_dev.go`                                                                                                                                                                                                                               | Sonnet lane, Go       | `combined_dev_test.go`: `service combined` selects `outboundsim`; `everySimulator()` selects outbound so the plan tests cover it        |
| 1   | Default flip: `LANGWATCH_GO_ONE_PROCESS` on unless `0` (`cmd/root.go:408`), help text (`cmd/help.go:184`), comments (`app/config.go:128`, `app/plan.go:346-349`), spec scenario (`haven-local-topology.feature:177-187`), haven skill lines 70-72, `LOCAL_STACK.md` | Sonnet lane           | `optionsFromEnv`: unset -> on, `0` -> off; the split scenario reads "with `LANGWATCH_GO_ONE_PROCESS=0`"                                 |
| 2   | Go debounce aligned under air: default 750 -> 2000 (`Makefile:196`), ignore `_test.go`                                                                                                                                                                              | Sonnet lane           | none (Makefile); proven live once                                                                                                       |
| 3   | haven's own watcher + builder + swap replaces air: debounce clock (quiet, max wait, dirty-during-build), build to `.bin/combined/<slug>`, failed build keeps the child and reports it                                                                               | Opus lane, haven      | unit: the debounce clock; unit: a failed build keeps the old child; plan test: the go child is a built binary, not `make service-watch` |
| 4   | The daemon supervises each stack's Go child (Q1): launcher asks over the hub API, child in its own process group, logs to files, re-adopted by pid after a daemon restart                                                                                           | Opus high, needs Q1   | integration with a fake child: daemon restart keeps the child pid; launcher death reaps it                                              |
| 5   | Console HMR: webconsole dev proxy, injected dev URLs, lazy Vite reuse, no console build before Go start; haven-web the same                                                                                                                                         | Opus lane (Go + Vite) | webconsole unit test against an `httptest` upstream (asset and WebSocket upgrade proxied, `/api` not); plan test for the injected URLs  |
| 6   | ADR (one Go app per stack under the daemon), `LOCAL_STACK.md`, haven and sims skills, `specs/setup/haven-local-topology.feature`                                                                                                                                    | coordinator           | feature-parity check                                                                                                                    |

Slices 0-3 and 5 hold under any answer to Q1. Slice 1 needs slice 0: flipped first, `+outbound`
takes the gateway down.

## 10. Open questions (options and recommendation)

**Q1. Who supervises the per-stack Go child?** (a) The daemon, Go only; Node lanes stay with the
launcher. (b) The daemon supervises the whole stack (Node too); `haven up -d` becomes a client that
returns. (c) The launcher keeps supervising; slice 1's one child per stack is the "one Go app".
Recommend **(b)**, done once as its own design: (a) splits status, restart and logs across two
supervisors. Until then, slices 0-3 and 5 deliver everything but the daemon hosting.

**Q2. Literal one PID (option C) or one child per stack (A)?** Recommend **A** (section 4).

**Q3. Isolation default.** (a) One child, split by `LANGWATCH_GO_ONE_PROCESS=0` for load runs.
(b) Keep the split default. (c) haven auto-splits when a load run starts. Recommend **(a)**: the
ruling asks for one; (c) needs haven to know a load run is happening, which it does not.

**Q4. Swap gap.** (a) Sequential restart, under a second of refused connections. (b) Listener
hand-over, zero drop, every service takes a `net.Listener`. Recommend **(a)**, measure, then (b) only
if callers fail on it.

**Q5. Do Go rebuilds queue on the machine slot (ADR-090)?** (a) No gate. (b) Through `haven slot`.
Recommend **(b)**: twenty stacks reacting to one shared-package edit would otherwise build at once.

**Q6. haven's own code (the daemon is not watched).** (a) Stay unwatched; `make haven` then a daemon
restart, which re-adopts children once slice 4 lands. (b) Auto-watch `tools/thuishaven`. Recommend
**(a)**: an AI mass edit of haven would bounce every stack on the machine.

## 11. Slice 4 design: the daemon supervises the stack

Rulings: HAVEN-SUPERVISOR and HAVEN-REBUILD (round 73) settle Q1 (b) and Q6 (watched);
HAVEN-ISOLATION, HAVEN-SWAP, HAVEN-SELF-WITH-S4, HAVEN-ONE-SWITCH, HAVEN-WATCH-DEFAULT (rounds 73-74)
hold below. Choices no ruling covers are in 11.9.

### 11.1 The fact that shapes it

Whoever holds a child's stdout pipe cannot restart without the child losing its output: once the
reader is gone the next write fails with EPIPE, which ends a Go service (SIGPIPE on fd 1 and 2) and
a Node process (unhandled stream error). Today the launcher holds every pipe (`proc.pipe`,
`adapters/procsupervisor/supervisor.go:423`). So the daemon must never hold a lane's pipe. It
supervises through a **keeper**: one small process per stack, in its own session, running today's
`procsupervisor.Supervise` unchanged. The daemon decides, starts, stops, reaps and re-adopts
keepers; a keeper only runs lanes and captures their logs.

```text
haven up (client)   provision as today -> plan.json -> POST /api/stacks/{slug}/start -> returns
haven daemon        spawns, watches, reaps, respawns keepers; holds no lane pipe
 └─ haven keep <slug>   Setsid; stdout -> <slug>.log; today's Supervise
     ├─ app, api, worker lanes   own pgid, pipes -> logSink files (unchanged)
     ├─ go lane: haven go-watch -> .bin/combined/<slug> combined aigateway nlpgo <sims>
     └─ langy, langevals, ...
```

The keeper takes the launcher's place in the registry: `LauncherPID` keeps its name and meaning
(the process whose tree is the stack), so the reaper (`app/daemon.go:186`), pressure governance
(`:299`, `:315`), `StackRSSByLauncher`, `restartServices` (`app/restart.go:90`) and `haven down`
(`app/orchestrator.go:896`) work as written. Alternatives: D1.

### 11.2 State files and pid ownership

| File                                                                           | Single writer                                   | Readers                  | Holds                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `<haven home>/haven.lock`, `haven.json` (default home `~/.langwatch/portless`) | daemon                                          | every CLI                | flock held for the daemon's life (D9); its port                                  |
| `registry/<slug>.json` (`domain.Stack`)                                        | the provisioner until handover, then the keeper | daemon, CLI              | `LauncherPID` (keeper), new `LauncherStart`, `OwnerPID`, `OwnerStart`; heartbeat |
| `<stack log dir>/plan.json`, 0600                                              | the provisioner                                 | daemon (respawn), keeper | lanes (`[]app.Child`), base env (D2), `startedAt`, owner                         |
| `<stack log dir>/pids.json`                                                    | keeper, on every lane (re)start                 | daemon, `down -f`        | per lane: child pgid and its leader's start time                                 |

- Every stored pid carries its process start time. A pid is ours only when both match
  (`ProcessStart(pid)`, D6); one whose start time differs is dead to haven and never signalled.
- A lane group is signalled only when its leader matches, or the leader is gone and the group
  still has members: POSIX forbids reusing a pid while a process group with that id exists, so a
  non-empty group cannot be a stranger's.
- Registry and pid files are written through `adapters/atomicfile`. Today `SaveStack` is
  `os.WriteFile` (`adapters/fileregistry/store.go:44`): a reader racing a heartbeat can read a torn
  file and drop a live stack.
- The daemon reads and deletes registry entries and never writes one, as today. One writer per
  file is what removes lost updates.

**Races on handover and adopt.**

1. _Handover._ The reaper must never see a dead `LauncherPID` mid-swap. The provisioner (its own pid
   still in the record) writes `plan.json` and calls start; the daemon spawns the keeper; the keeper
   rewrites the record with its pid; the daemon answers once it reads that record back (bounded,
   10 s); only then does the provisioner exit or turn client. A provisioner killed mid-handover
   leaves either its own dead pid (reaped as today) or the keeper's (the stack lives and the owner
   rule applies).
2. _Two daemons._ The singleton is an flock: the kernel drops it when the holder dies, so there is
   no stale record and no pid to test. A successor blocks on it until its predecessor has exited.
3. _Adopt before serve._ A starting daemon reconciles every registry entry before it opens its
   port, so no CLI call meets a half-adopted machine (`ensureDaemon` already waits 5 s,
   `app/daemon.go:28`).
4. _Adopt versus exit._ Reconcile is level-triggered on the 10 s tick: a keeper that dies just
   after its check is caught on the next one. Nothing waits on an event.
5. _Down versus respawn._ Start, down and the tick's respawn take the existing `up-<slug>`
   semaphore (`o.sem.Acquire` in `Orchestrator.Up`) and re-read the record after taking it: no
   record, no respawn.

Re-adopting by pid is therefore cheap: the daemon keeps no per-stack state in memory that a restart
loses. Adoption is reading the registry and checking each keeper's identity.

### 11.3 Logs survive a daemon restart

- The daemon holds no lane pipe, so its restart or crash loses no line. The keeper keeps today's
  capture (`proc.pipe`, `logSink`, crash dedup, raw window); its own stdout and stderr go to the
  stack's combined log at 0600, as `startDetachedUp` does today (`cmd/root.go:777`).
- Every reader already reads files: `haven logs`, the hub's `/api/logs`, the up viewer. The one
  in-memory consumer, the foreground preview (`renderUp`, `supervisor.go:587`), is replaced by
  following the files, the `haven logs -f` path.
- `plan.json` carries the stack's `startedAt`, so a respawned keeper appends to this up's captures
  instead of rotating them out (`newLogSinkSince`).
- A keeper crash closes the pipes: lanes die on their next write and what sat in the pipe buffer
  is lost. The respawned keeper restarts them (11.6). Accepted: a keeper is a loop around `exec`.

### 11.4 What `haven up` and `haven down` become

| Shape                              | Today                                                                        | Slice 4                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal `haven up`                | Setsid launcher plus viewer (`cmd/root.go:847`)                              | Setsid provisioner hands over and exits; the viewer follows files; no owner                                                                                                                                             |
| `haven up -d`, `--agent -d`        | Setsid launcher, returns                                                     | the same, returns at once; the provisioner hands over in the background                                                                                                                                                 |
| Foreground agent or pipe           | launcher in-process; stops with its launching group (`cmd/launcherwatch.go`) | provisions in-process, hands over with `OwnerPID` = itself, then follows files to stdout. Ctrl-C, SIGTERM or launching group gone: it downs the stack. SIGKILL: the daemon downs it on owner death within one tick (D7) |
| Hub start (`app/stackstart.go:32`) | spawns `haven up`                                                            | unchanged                                                                                                                                                                                                               |

In `Orchestrator.Up` only the tail changes: `o.sup.Supervise(ctx, children)` becomes the handover;
`cleanup` (routes, record) is no longer deferred past it and moves to down and the reaper; the
heartbeat goroutine (`app/orchestrator.go:327`) moves into the keeper. Provisioning output stays
on the up process's stdout (or the combined log when detached), so no writer is threaded through
provisioning and the daemon never runs provisioning code.

`haven down` stays in-process and needs no daemon: SIGTERM the keeper (identity-checked; it stops
its lanes' groups, 5 s, SIGKILL, exits), wait, remove routes and record, all under `up-<slug>`.
`-f` also SIGKILLs every group in `pids.json`. A broken daemon never stops you stopping a stack.
`haven restart <svc>` is unchanged (port bounce, the keeper restarts the child), and so is the Go
swap inside `haven go-watch` (HAVEN-SWAP). HAVEN-ISOLATION and HAVEN-ONE-SWITCH are plan-time: the
keeper runs what `planChildren` produced, one combined Go child per stack unless
`LANGWATCH_DEV_ONE_PROCESS=0`.

### 11.5 Rebuilding the daemon without killing children

- Keepers are Setsid (outside the daemon's group and session) and their stdio is files, so
  nothing the daemon owns is on a child's path. The daemon's exit removes only the hub, alias,
  telemetry and home routes (`app/daemon.go:98-103`) and signals nobody; stack service routes live
  in portless and stay.
- Self-watch (HAVEN-REBUILD, HAVEN-SELF-WITH-S4): the daemon runs a `gowatch.Watcher` with the same
  `Clock` and knobs over `tools/thuishaven`, `tools/go.mod` and `tools/go.sum` of the checkout it
  was built from (D4). A due burst runs `go build -o <exe>.next ./thuishaven` in `tools/`. A failed
  build logs, shows on the hub and keeps the daemon. A good build renames over `os.Executable()`
  (atomic; running keepers keep their inode), spawns `haven daemon --after <pid>` Setsid and exits;
  the successor waits for the flock, reconciles, serves. The hub and homes refuse for about a
  second; no stack notices.
- `haven daemon restart` is the same successor step by hand (D10).
- Keepers and `haven go-watch` run the haven build they started with until their stack's next up.
  That is inherent (the pipe holder cannot change code without its children losing their pipes);
  keeping the keeper to `Supervise` keeps that code rarely changed (D8).
- Self-rebuild needs only the flock claim: today's launchers are already Setsid and outlive the
  daemon, so S4d can land before the keeper.

### 11.6 Failure modes

| Case                                  | Seen by                                   | Response                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon crashed, record left           | flock free                                | successor claims; no pid test                                                                                                                                                    |
| Daemon pid reused                     | not consulted                             | none                                                                                                                                                                             |
| Keeper died (panic, SIGKILL, OOM)     | tick: identity fails                      | under the lock, kill each `pids.json` group still ours, then respawn from `plan.json`; backoff 1 s doubling to 60 s; 5 respawns in 10 min: reap, reason "keeper crash loop" (D3) |
| Keeper pid reused by a stranger       | start time differs                        | treated as dead; the stranger is never signalled                                                                                                                                 |
| Lane child orphaned by a keeper crash | `pids.json` and the group rule            | killed before the respawn; `reapOrphans` (`supervisor.go:182`) stays as the backstop at keeper start                                                                             |
| Lane pgid reused                      | leader start differs, no leaderless group | skipped                                                                                                                                                                          |
| Foreground owner gone                 | tick: owner identity fails                | stack downed (today's launcher-death meaning)                                                                                                                                    |
| Keeper wedged, no heartbeat           | `UpdatedAt` older than `HAVEN_IDLE_TTL`   | today's `reapStack`: SIGTERM the keeper, drop routes                                                                                                                             |
| Keeper dies while no daemon runs      | the next daemon's reconcile               | as keeper died                                                                                                                                                                   |
| Provisioner dies mid-handover         | race 1                                    | as race 1                                                                                                                                                                        |
| Reboot                                | every identity fails                      | entries reaped on the first tick                                                                                                                                                 |

### 11.7 Test plan

Unit, with fake `sys` and `store` (precedent `app/daemon_stack_reaper_test.go`):

- identity: a start-time mismatch is dead; a leaderless non-empty group is ours; a stranger is
  never signalled.
- handover: `reapDeadStacks` never reaps across the provisioner-to-keeper swap.
- keeper died: orphan groups killed before the respawn; backoff; give-up after 5 in 10 min.
- owner died: stack downed; a `-d` stack (no owner) untouched.
- daemon exit removes only its own routes and sends no signal.
- self-watch: a failed build keeps the daemon; a good build spawns the successor argv.

Real processes (temp haven home; a fake lane is a tiny test binary that prints a counter and
listens on a port):

- a daemon restart keeps the lane pid, and its log keeps growing with no gap in the counter.
- keeper SIGKILL: the old lane pid is gone, a new one serves, the record is updated.
- flock: a second daemon defers while the first lives and claims after it is SIGKILLed.
- `haven down` with no daemon running stops the stack.

Spec `specs/setup/haven-lifecycle-usability.feature`: reword l.45 (launcher to keeper), keep
l.146, add "A daemon restart keeps every stack running", "A crashed keeper's stack comes back and
leaves no orphan", "haven down works without the daemon" and "A haven edit rebuilds the daemon; a
failed build keeps the old one", each bound by `@scenario` on its Go test (slice 3 precedent).
Live proof once: two stacks up, edit a haven file; the daemon pid changes, `pgrep -f .bin/combined/`
and the api pid do not, and `haven logs api -f` is unbroken.

### 11.8 Lanes (30 calls or fewer each)

| Lane                         | Scope                                                                                                                                                                                                                                         | Needs            | Model                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------- |
| S4a identity and claim       | `ProcessStart` on System; `Stack.LauncherStart`, `OwnerPID`, `OwnerStart`; atomic `SaveStack`; flock daemon claim; identity checks in the reaper, down, restart and governance; unit tests                                                    | D6, D9           | Opus medium           |
| S4b keeper                   | hidden `haven keep <slug>`: reads `plan.json`, runs `Supervise`, writes its record, heartbeat and `pids.json`; `Up` writes `plan.json` and, until S4c, spawns the keeper itself and waits for the record; the foreground client follows files | S4a, D1, D7      | Opus high             |
| S4c daemon start and respawn | `POST /api/stacks/{slug}/start`, spawn from `plan.json` with its env, owner-death down, keeper respawn with orphan kill and backoff; real-process tests                                                                                       | S4b, D2, D3      | Opus high             |
| S4d self-rebuild             | daemon self-watcher, build, rename, successor `--after`, `haven daemon restart`; tests and live proof                                                                                                                                         | S4a, D4, D5, D10 | Opus medium           |
| S4e docs                     | lifecycle scenarios and bindings, `LOCAL_STACK.md`, haven skill and troubleshooting, ADR-064 amendment                                                                                                                                        | all              | Sonnet or coordinator |

S4d can run beside S4b.

### 11.9 Decisions for Alex

| #   | Decision                                     | Options                                                                                                                                                                                                                                                                                                                                                                          | Recommend                                                                                                            |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D1  | What holds the lanes' pipes                  | (a) one keeper per stack; (b) one shim per lane (finer restarts, about six extra processes per stack); (c) none: the daemon owns children that log straight to files (needs a tailer, loses timestamps and dedup, lanes are not restarted while the daemon is down); (d) the daemon re-execs in place keeping pipe fds (planned restarts only; a daemon crash kills every stack) | (a): `Supervise` reused unchanged, today's process count                                                             |
| D2  | Who spawns the keeper                        | (a) the daemon, from `plan.json` carrying the up's base environment at 0600 (literal HAVEN-SUPERVISOR; makes respawn possible); (b) the up process, inheriting its environment; the daemon only watches                                                                                                                                                                          | (a); the snapshot is the same class of file as the 0600 combined log, but it is secret-adjacent, so Opus-high review |
| D3  | A crashed keeper                             | (a) respawn with backoff, give up after 5 in 10 min; (b) reap and say so, `haven up` recovers (today's "never respawns a stack it did not start")                                                                                                                                                                                                                                | (a) with D2 (a); (b) with D2 (b)                                                                                     |
| D4  | Which haven source the daemon watches        | (a) the checkout it was built from; (b) any worktree's `tools/thuishaven` (twenty branches would flip one machine-wide daemon); (c) none, `haven daemon restart` only                                                                                                                                                                                                            | (a)                                                                                                                  |
| D5  | Self-watch switch                            | (a) `LANGWATCH_GO_WATCH=0`, read at daemon start (one switch); (b) its own `HAVEN_SELF_WATCH`                                                                                                                                                                                                                                                                                    | (a)                                                                                                                  |
| D6  | Process start-time source                    | (a) `ps -o lstart= -p` (no dependency, 1 s resolution, haven already shells out to ps); (b) promote `golang.org/x/sys` to a direct dependency (sysctl, `/proc`; microseconds)                                                                                                                                                                                                    | (a)                                                                                                                  |
| D7  | Foreground `haven up --agent` after handover | (a) stays a client following logs and downs the stack when it or its group goes (keeps today's foreground lifetime); (b) returns like `-d`                                                                                                                                                                                                                                       | (a)                                                                                                                  |
| D8  | Keepers on an older haven build              | (a) accept until the stack's next up, documented; (b) also flag it in `haven status`; (c) restart keepers on rebuild (bounces every stack)                                                                                                                                                                                                                                       | (a)                                                                                                                  |
| D9  | Daemon singleton                             | (a) an flock held for life (precedent `adapters/fileregistry/store.go:639`, `:769`); (b) keep O_EXCL `haven.json` plus a start-time check                                                                                                                                                                                                                                        | (a)                                                                                                                  |
| D10 | `haven daemon restart`                       | (a) add it (today the only restart is killing the daemon and waiting for the next up); (b) rebuild path only                                                                                                                                                                                                                                                                     | (a)                                                                                                                  |
