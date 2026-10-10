---
name: dev-runtime
description: "How the Node side of a dev stack runs without haven, and the one-process lane: `pnpm dev`, `pnpm dev:one`, `LANGWATCH_DEV_ONE_PROCESS=1`, tools/dev-runtime (ui + api + worker in one Node process), backend reload on a file change, the debounce (quiet window + max wait), ports derived from PORT. Use when someone says 'pnpm dev', 'dev:one', 'one process', 'the app lane', 'backend reload', 'why did the api restart', 'reload storm', 'ADR-168', 'dev-runtime', 'backend ready', or 'LANGWATCH_DEV_WATCH'. ADR-168 is Accepted (2026-10-09); one process is the default and `LANGWATCH_DEV_ONE_PROCESS=0` splits."
user-invocable: true
argument-hint: "[dev | dev:one | reload | ports]"
---

# dev-runtime and the one-process lane

`tools/dev-runtime` (`@langwatch/dev-runtime`) is contributor-only. It hosts the Node
applications of a local stack so no app carries a dev branch (record §1). Production still
runs each app's own `main.ts`, and the helm chart runs api, worker and tasks as split apps.

**Status of ADR-168** (`dev/docs/adr/168-one-process-dev-with-debounced-module-reload.md`):
`Accepted` on 2026-10-09 (amendment "one process is the default"): `pnpm dev` and `haven up`
start the single `app` lane, and the split stack's api lane reloads in-process (ADR-168 "Step 3,
as shipped"). The open questions at the foot of the ADR that remain are Alex's, not answered.

## The two shapes

| Shape                 | Node processes                                                   | Start                                  | Reload                                                      |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Split                 | `ui` lane (Vite) + `backend` lane (api and worker in one `node`) | `LANGWATCH_DEV_ONE_PROCESS=0 pnpm dev` | re-links only what a change reaches, in process (see below) |
| One process (default) | one `app` lane: Vite, api and worker                             | `pnpm dev`, or `pnpm dev:one` alone    | re-links only what a change reaches, in process             |

- `pnpm dev` runs `dev/scripts/dev-stack.sh`, which runs the lanes
  through `concurrently`: `ui`, `go`, `langy`, then `backend` (or `app`). It runs the upgrade
  (`start:prepare:db`, `pnpm task upgrade`) once before any lane starts. Run it from the root.
- Under haven the same switch applies, and it also folds the simulators into the Go lane:
  `LANGWATCH_DEV_ONE_PROCESS=0` in the environment or `.env`, then `haven up -f`, splits both.
  `LANGWATCH_GO_ONE_PROCESS` is a deprecated alias (warned; refused if it disagrees). `haven logs ui|api|worker` then read the one `app` capture,
  and `haven restart ui` or `api` restarts the whole process (`dev/docs/LOCAL_STACK.md`,
  section "One process").
- Other scripts in the root `package.json`: `dev:ui`, `dev:api`, `dev:worker`,
  `dev:backend` (api + worker, one process), `dev:go`, `dev:cli` (the npx CLI, see
  `server-cli`). Use `dev:api` plus `dev:worker` for performance work: one event loop in
  `dev:one` skews timings.

## What the host does (`tools/dev-runtime/src`)

- `app.entrypoint.main.ts`: starts the UI's Vite server (`apps/ui/vite.config.ts`,
  unchanged, `/api` still proxied) and loads api and worker through a Vite module runner.
- `app.entrypoint.ts --backend-only`: the split shape's api lane (`pnpm --filter
@langwatch/dev-runtime dev`), the same host without the UI's Vite server. The `dev` script's loop
  restarts it only when it exits 75 (a recycle). An edit to the
  host's own `src/` (Node loaded it natively) logs that it applies on the next restart:
  `haven restart app`.
- `backend.entrypoint.main.ts`: api and worker in one Node process with no reload
  (`pnpm start`).
- `backend.reload.ts`: finds the loaded modules a changed file reaches
  (`staleModuleIds`) and drops only those; reloads are debounced, never held.
- `backend.process.ts`: `startBackend` boots the api and the worker together (the api never waits on the upgrade
  and holds no request: a Postgres read ahead of the schema answers `upgrade_in_progress`, NO-HOLDS);
  `drainBackend` stops the worker first, then the api.

A backend edit that touches a loaded file re-links, drains the old generation and boots the
new one; the browser keeps its HMR socket. A change that does not link leaves the old
generation serving. A failed boot waits for the next change. Each generation logs one
`backend ready` line: generation number, changed files, `drainMs`, `readyMs`, `rssMiB`.

## Reload knobs

| Variable                            | Effect                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `LANGWATCH_DEV_WATCH=0`             | still: no reload on a change; `haven reload` (SIGUSR2) applies them (haven sets it unless `up --watch`/`--hmr`) |
| `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`   | quiet window before a reload (2000)                                                                             |
| `LANGWATCH_DEV_WATCH_MAX_WAIT_MS`   | never defer longer than this after the first change (30000)                                                     |
| `LANGWATCH_DEV_RECYCLE_GENERATIONS` | api lane: after this many generations, the next edit restarts the process (50)                                  |
| `LANGWATCH_DEV_RECYCLE_RSS_MIB`     | api lane: past this RSS, the next edit restarts the process (4096)                                              |

There is no agent-turn hold (retired 2026-10-09, ADR-168): the debounce alone coalesces a
turn's edits, and `haven hmr` no longer exists. A skipped change is `.md`, `.mdx`, `.feature`, a `tsconfig*.json`,
a `.json` outside `src/`, or a package the watched command cannot reach. The authority for
this is `tools/dev-runtime/src/app.entrypoint.main.ts` (the supervisor script is gone, ADR-168 amendment 2026-10-10).

## Ports

All derive from `PORT` (default 5560) in `dev/scripts/lib/derive-dev-ports.sh`: ui `PORT`,
api `PORT+1000`, gateway `PORT+3`, worker metrics `PORT-2561`; `dev/scripts/dev-stack.sh`
adds the Redis DB index `(PORT-5560)/10`. An explicit `API_PORT` or `WORKER_METRICS_PORT` wins. Two stacks need
two `PORT`s (5570, 5580, ...). A held port stops the launcher with a line saying which.
The mail preview runs inside the ui dev process on `PORT+6`, started on first visit and closed
after idle; `LANGWATCH_MAIL_PREVIEW_SPAWN=1` runs it as its own process instead.

## Failure shapes

- A reload storm after a burst of agent writes: raise `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`;
  the log names the changed files per generation.
- `backend did not link` after an edit: the old generation keeps serving. `boot failed;
waiting for a change`: the old one is drained and the next change retries. Fix the file;
  do not restart the lane.
- Memory growing over many generations: note `rssMiB` per `backend ready` line; a restart
  is the guardrail. Report it, since it is an ADR-168 risk.

## Profiling the host

- Inspector: `kill -USR1 $(pgrep -f "src/app.entrypoint.ts" | grep -v sh)` opens `127.0.0.1:9229`. Do it again after every restart, because the pid changes.
- Drive it over CDP from a script: `Profiler` for CPU, `HeapProfiler.startSampling` for allocations, `Debugger.enable` (its `scriptParsed` events give each loaded script's url and length), and `HeapProfiler.takeHeapSnapshot` for a full dump.
- A snapshot of this heap is gigabytes: summarise it with a streaming parser or memlab, never `JSON.parse`. Scratch files go in `.claude/tmp/prof/`.
- What it showed (2026-10-10, dev UI in-process):
  - RSS is about 2.7 GB, of which about 1.5 GB is JS heap (500 MB of it large objects). A boot takes about 40 s (`readyMs`).
  - At rest the process is about 90% idle, so the boot is the CPU cost.
  - Most of the heap was loaded code: the module runner kept each backend module's transformed code with an inline base64 source map, beside the map in Vite's module graph and V8's own copy (fixed, see below).
  - `modules/analytics/contract/src/visualization/vega-lite-schema-validator.generated.js` is 8 MB on disk and evaluates as a 41M-char script.
  - The other big ones: sass, the prisma client, `@clickhouse/parser`, `model-catalog.json` and `lwql-prisma-manifest.generated.json`.
- The built UI, haven's default, takes the UI's Vite server out of the process altogether.
- Inline source maps are off since 2026-10-10 (`startBackendVite`, `createBackendRunner`): each evaluation gets `//# sourceURL=<id>?lw=<n>` and stack traces map through the maps Vite's module graph already holds, so a frame still reads `throws.ts:12:9`, also after an edit. Backend-only import A/B (`.claude/tmp/prof/srcmap/boot.mjs base|lane`):

  |                      | heap after GC | RSS after GC |
  | -------------------- | ------------- | ------------ |
  | inline maps (before) | 1108 MB       | 2873-3097 MB |
  | no inline maps (now) | 503-506 MB    | 1938-2392 MB |

  Boot times from that run are void (load average 25-68); an earlier quiet run measured 21.4 s -> 18.2 s.

## Where to read next

`dev/docs/LOCAL_STACK.md` (processes, one process section), `specs/setup/dev-process-topology.feature`
(the requirements), `dev/docs/best_practices/dev-log-format.md` (lane log columns), the
`haven` skill for the supervised stack.
