# ADR-168: One-process dev with gated, in-process backend reload

**Date:** 2026-09-30

**Status:** Proposed

**Related:** [ADR-004](004-docker-dev-environment.md) (amendments 2026-09-07: the `backend` lane
and debounced restart), [ADR-111](111-physical-application-workspaces.md) (`tools/dev-runtime`),
[ADR-150](150-nx-task-runner.md), `ARCHITECTURE.md` §1 (no dev-only branch in an app), §4 and §5
(`Server`, `container(role)`, `boot()`), `dev/docs/LOCAL_STACK.md`,
`specs/setup/dev-process-topology.feature`, commit `be837437bc` (helm runs api, worker, tasks split).

## Context

Alex, 2026-09-30: run worker, api and ui together, keep the footprint small with few Node
processes, and reload worker and api on backend changes without dying from AI write speeds.

### Today, measured 2026-09-30

The live check stack (`visualdiff-check`, haven, watch off) is the only stack running.

| Process (haven stack)                                            | RSS           |
| ---------------------------------------------------------------- | ------------- |
| `pnpm --filter @langwatch/dev-runtime dev` (node + native)       | 34 + 11 MiB   |
| `dev-supervisor.mjs --watch` (node)                              | 32 MiB        |
| backend: api + worker, one `node --experimental-transform-types` | **2,206 MiB** |
| `pnpm --filter @langwatch/ui dev` (node + native)                | 34 + 11 MiB   |
| Vite (node), idle, no browser session                            | 142 MiB       |
| **Node total** (5 node + 2 pnpm-native)                          | **2,470 MiB** |
| haven (Go) 47, `combined` Go lane 296, langevals (Python) 193    | 536 MiB       |

The backend holds 8 Postgres, 8 Redis and 66 ClickHouse sockets: api and worker each open their
own stores and each installs all modules (ADR-004, 2026-09-07: "neither shares"). Plain
`pnpm dev` adds layers (outer supervisor and sentinel, `pnpm exec`, `concurrently`, a
`log-render.mjs` per lane, a pnpm per lane): about 13 Node processes, 10 of them wrappers,
estimated at 350 MiB from the script chain (no plain stack was running to measure).

`apps/server` (the npx CLI) does not run the three together: it spawns `pnpm run start` in
`apps/api` and in `apps/worker` as two production-mode processes, and the api serves the built UI
bundle. No Vite, no watch.

"dev-env" names no package. The candidates are `tools/dev-runtime` (the backend lane),
`dev/compose.dev.yml` with `make quickstart` (ADR-004's original Docker environment) and
`dev/scripts/ensure-langy-dev-env.sh`.

### How reload works today

`dev/scripts/dev-supervisor.mjs --watch` runs `fs.watch` (recursive) over `src`, `packages/`,
`modules/` and `enterprise/`, feeds a trailing-edge debounce (750 ms, no max wait), then SIGTERMs
the child, waits up to 5 s, SIGKILLs, and spawns a fresh Node process. Vite HMR has its own gate
(`apps/ui/vite/havenHmrGate.ts`: 300 ms burst gap, 500 ms settle, and the `.haven-hmr-gate`
marker `haven hmr on` writes). Go restarts through `air` on successful builds only.

From this worktree's api lane log (29 Sept, 148 restarts over five hours):

| Measure                                             | Value                                |
| --------------------------------------------------- | ------------------------------------ |
| files per restart                                   | median 2, max 31                     |
| takedown (restart line to last old line)            | median 2.5 s, max 13.6 s             |
| cold start (last old line to first new)             | median 10.4 s, p10 5.1 s, p90 23.7 s |
| restarts within 15 s of the previous one            | 65 of 147 (mid-boot)                 |
| fatal boot failures                                 | 24                                   |
| lane respawns by haven (`exited, restarting in 1s`) | 21                                   |

### What agent writes do to it

1. **The debounce never coalesces.** An agent writes one file per tool call, seconds apart. A
   750 ms quiet window sees every edit as its own burst: median 2 files per restart, and each
   costs about 13 s of API downtime.
2. **Restarts pile up.** 44% landed while the previous boot was still running. `onChange` is not
   serialised: a second debounce firing during a 5 s takedown runs `takeDown` and `spawnOne`
   again, so two children can run at once. The log shows it: 9 `EADDRINUSE` boot failures.
3. **Half-written trees crash the lane, and the crash is fatal.** `Cannot find module
.../metered-usage-warning.service.ts`, `WebhookGovernanceDeliveryService is not defined` (4):
   an import landed before its target. A crashed child after a restart makes the supervisor
   exit. Under haven the lane respawns every 1 s through pnpm again. Under `pnpm dev`,
   `concurrently --kill-others-on-fail` takes the whole stack down.
4. **It restarts for what the backend never loads.** 32 of 281 trigger files were `.json`,
   `.feature` or `.md`. Browser-only packages under `packages/` (design-system, browser-host)
   restart it too; only `modules/*/browser` is ignored.
5. **Nothing waits for a typecheck.** A restart races whatever the agent does next.

## Options

|        | Shape                                                                                 | Node processes              | Node RSS (est.) | Backend reload (est.)   | UI on backend change    |
| ------ | ------------------------------------------------------------------------------------- | --------------------------- | --------------- | ----------------------- | ----------------------- |
| today  | ui + backend lanes, watcher per lane                                                  | 5 (haven), ~13 (`pnpm dev`) | 2.47 GiB        | ~13 s, piles up         | untouched               |
| **A**  | one process (Vite + api + worker), whole-process restart                              | 1                           | 2.4 to 2.8 GiB  | ~13 s + Vite cold start | dies, cold re-transform |
| **B1** | one process; backend re-evaluated through Vite's module runner, composition re-booted | 1                           | 2.6 to 3.2 GiB  | 3 to 6 s                | untouched               |
| **B2** | one process; re-install only the changed module                                       | 1                           | as B1           | 1 to 2 s                | untouched               |
| **C**  | today's two processes, one shared Go watcher in haven, gated                          | 2                           | 2.35 GiB        | ~13 s, serialised       | untouched               |

Merging processes saves the wrappers (120 MiB under haven, about 350 MiB under `pnpm dev`) and
one V8 baseline. The 2.2 GiB backend is the real lever and no option shrinks it by itself.

**A** puts Vite inside the process that restarts, so every backend edit kills the HMR socket and
forces the browser to re-transform the graph. Worse than today for UI work. Rejected.

**B1** keeps one long-lived host in `tools/dev-runtime`. It loads `startApi` and `startWorker`
through Vite's `ModuleRunner` (Vite 8 is installed; Vitest already runs the full `createApp`
chain through the same runner in installation tests). Node's native ESM cache cannot be
invalidated, and cache-busting `import()` leaks every generation; the runner's graph can be
invalidated per file and old instances are collectable. A reload invalidates the changed files
and their importers, imports the new generation, and only if it links drains the old one (worker,
then api, as `drainBackend` does today) and boots the new. Untouched module code stays cached, so
the reload pays drain, store reopen and install, not the 10 s cold start. node_modules stay
external, so library singletons and OTel's hooks see one copy.

**B2** needs the kernel to do what it refuses on purpose. `LocalFeatureApi.bind` throws when bound
twice. The eventing runtime refuses a second registration (14 of today's fatal boots are
`Pipeline "governance_events_processing" is already registered`). Transports mount once into one
router. A contract change cascades to every dependent. Per-module `ResourceScope`s make it
possible, but the saving over B1 is about a second and the cost is §5's guarantees. Rejected
for now.

**C** is the smallest change: haven (Go, already the supervisor) owns one watcher and the gate
below, and runs `node` directly instead of pnpm and the supervisor. It fixes the failure modes,
not the reload time or the process count.

### The trigger policy, for every option

The shape decides reload cost; the trigger decides how often it is paid.

- **Serialise.** One reload at a time. Changes during a reload queue into exactly one follow-up.
- **Gate on the agent's turn, not the clock.** haven already installs hooks per worktree. It adds
  `PostToolUse` on `Edit|Write|MultiEdit` (hold, renewed per write, 60 s cap) and `Stop` (release
  this session's hold). The backend reloads when no session holds and the quiet window has
  passed. A human's editor never holds, so humans keep 750 ms. It reuses `.haven-hmr-gate`, so
  Vite and the backend share one gate.
- **Link before you drop.** Import the new generation first. A missing module or export keeps
  the old generation serving and prints one line: the Node analogue of `air`.
- **A failed boot waits.** It never exits the lane, never trips `--kill-others-on-fail`, never
  enters haven's 1 s respawn loop.
- **Skip what is not loaded.** Under B1 the runner's module graph is the filter: a file outside
  it (docs, specs, browser packages, JSON the backend never imports) triggers nothing.

## Decision (proposed)

Adopt the trigger policy first, then B1 as the dev shape: one Node process per stack, hosted by
`tools/dev-runtime`, running the UI's Vite server, the api and the worker, reloading the backend
in-process through Vite's module runner. C is the fallback if B1's measurements fail.

### Production parity is kept

`apps/api/src/main.ts`, `apps/worker/src/main.ts` and `apps/tasks` do not change. The seam exists:
`startApi` and `startWorker` take `ownsProcess` and `ownsTelemetry`. Images run each app's own
`main.ts`; the chart (`be837437bc`) runs api, worker and tasks as split apps. The host lives in
`tools/`, so §1's rule that no app carries a dev-only branch holds. There is no `"all"` role and no
`WORKERS_IN_PROCESS` (ADR-004, 2026-09-03): two containers, each booted by its own app's code.

### "Get rid of dev-env"

`tools/dev-runtime` stays: it is the host this ADR grows. Deleting it breaks haven's
`BackendPackage` (`tools/thuishaven/app/plan.go`), `dev-stack.sh`'s backend lane, `pnpm
dev:backend` and `specs/setup/haven-local-topology.feature`. Its only other homes, a dev branch in
an app or an `"all"` role, are forbidden. What goes: `dev-supervisor.mjs --watch`, the separate
`ui` lane, `concurrently` for the Node lanes, and the pnpm and supervisor wrappers. haven runs one
`node` for the stack. The compose quickstart is a separate decision (open question 4).

## Migration

1. **Trigger fixes in today's supervisor** (ships alone): serialise `onChange`, wait on a failed
   boot, skip non-code and browser-only packages, add the hold and release hooks to haven's hook
   installer. Spec scenarios first in `dev-process-topology.feature`.
2. **Measure before building:** boot phase timings (import, config and secrets, stores, install,
   listen) and a heap snapshot of the backend, to learn what the 2.2 GiB is and what B1 saves.
3. **B1 backend host:** `tools/dev-runtime` creates a Vite server (`appType: "custom"`, middleware
   mode, HMR off) and a `ModuleRunner`, loads both apps' start seams, and implements link, drain,
   boot. `LANGWATCH_DEV_RELOAD=process` keeps today's whole-process restart as the escape hatch.
4. **Host the UI's Vite server** in the same process with `apps/ui/vite.config.ts` unchanged, on
   `PORT`, proxying `/api` as today. haven's `ui` and `api` lanes become one `app` lane.
5. **Guardrails:** a generation counter and an RSS ceiling (default 4 GiB) trigger a full restart
   by haven; each reload logs its generation, changed files, drain time and time to serve.
6. **Record it:** an ADR-004 amendment, `LOCAL_STACK.md`, haven's README, and B1's specs.

## Step 1, as shipped

In `dev/scripts/dev-supervisor.mjs` (proof: `dev/scripts/reload-burst.mjs`, run it with
`--check`; `--ref HEAD` measures the committed supervisor for comparison):

- **One reload at a time.** The first boot is a reload too. A change while a boot runs is queued
  and answered by one follow-up when it settles: the child printed a line matching
  `LANGWATCH_DEV_READY_PATTERN` (`dev-runtime` prints `backend ready`), exited, or
  `LANGWATCH_DEV_BOOT_SETTLE_MS` (30 s) passed.
- **A crashed boot waits.** A non-zero exit logs one line and the supervisor stays up for the
  next change. With nothing watched it still exits, since no change can come.
- **Quiet window with a max wait.** 2 s of quiet (`LANGWATCH_DEV_WATCH_DEBOUNCE_MS`), never more
  than 30 s after the first change (`LANGWATCH_DEV_WATCH_MAX_WAIT_MS`).
- **Skip what is not loaded.** `.md`, `.mdx`, `.feature`, `tsconfig*.json` and any `.json` outside
  a `src/` tree (not `package.json`), plus every workspace package no dependency of the watched
  command reaches (13 of 164 packages for `dev-runtime`: design-system, browser-host and the
  like), derived from the `package.json` graph.
- **The agent-turn hold.** A restart waits while the `.haven-hmr-gate` marker
  (`apps/ui/.haven-hmr-gate`, unix-ms expiry, `LANGWATCH_DEV_HOLD_MARKER` overrides), is in the
  future, at most 60 s. The supervisor only reads it.
- **Not in step 1:** link-before-drop. Two whole-process backends cannot share a port, so a
  failed boot still takes the old one down (it is the crashed-boot wait that keeps the lane
  alive). It belongs to B1.

The hold hooks are **opt-in**; `haven up` installs nothing new (open question 2). To try them, add
to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "haven hmr on --ttl 60s" }]
      }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "haven hmr off" }] }]
  }
}
```

One marker serves every session in the worktree, so one session's `Stop` releases another's hold.

## Risks

- **State leaks across generations.** Workspace packages re-evaluated by the runner must not keep
  module-level state: registries, timers, `process.on` listeners, metric registration. Telemetry
  must be set up once by the host, not per generation (today the worker half owns it). The
  guardrail in step 5 bounds the damage; the proof measures RSS per generation.
- **BullMQ and GroupQueue consumers.** Drain on stop as today (worker first). A job cut by a
  bounded dev drain is retried (at-least-once). Blocking Redis connections must close with the
  generation, or each reload leaks one per consumer.
- **Open DB pools.** Stores open per boot today, so each generation opens and must close its own
  Prisma, ClickHouse and Redis clients. A leak shows as Postgres `max_connections` exhaustion.
  Keeping the stores across generations is faster but is exactly the sharing ADR-004 refused.
- **SSE and sockets.** Stopping the api closes SSE streams, raw-socket doors and the voice
  tunnel; the browser's SSE link reconnects as it does after today's restarts. Vite's HMR socket
  survives, which is the gain.
- **Runner semantics.** Code runs through Vite's transform, not `--experimental-transform-types`.
  `import.meta.main` is unused on this path, native addons and CJS stay external, and Vitest
  already exercises the graph this way. Production still runs native Node.
- **One event loop.** Vite transforms, worker jobs and api requests share it. Performance work
  stays on `pnpm dev:api` plus `pnpm dev:worker`, as ADR-004 already says.

## Proof

A script (`dev/scripts/reload-burst.mjs`) against a running stack, each run from cold:

| Run                    | Writes                                        | Pass                                      |
| ---------------------- | --------------------------------------------- | ----------------------------------------- |
| storm                  | 200 edits over 20 backend files in 2 s        | 1 reload                                  |
| agent cadence          | 200 edits, one per 1.5 s, hold hook active    | 1 reload, after release                   |
| agent cadence, no hook | same, no hold                                 | never two reloads at once, no lane exit   |
| broken mid-burst       | an import to a missing file, fixed 10 s later | old generation serves throughout; 0 exits |
| non-code               | 200 edits to `.feature`, `.md`, design-system | 0 reloads                                 |

Measured each run: reloads (log lines), time from the last write to the first 204 from
`/api/health` (polled every 100 ms), peak RSS of the lane tree (`ps` every 250 ms), Postgres and
Redis connection counts after the run, and RSS after 50 generations. Targets: time to serve at
most 5 s for B1, peak RSS at most today's Node total plus 15%, flat connection counts.

## Open questions for Alex

1. Is B1's one-process shape wanted even though the RSS saving is small (wrappers only) unless
   api and worker share stores, which ADR-004 (2026-09-07) refused?
2. May haven install `PostToolUse` and `Stop` hooks per worktree by default, as it does the gate?
3. Should the npx CLI (`apps/server`) also run api and worker in one process, without watch?
4. Does "dev-env" mean the compose quickstart? If so, retire `make quickstart` and ADR-004's
   compose presets separately.
