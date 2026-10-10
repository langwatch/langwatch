---
name: dev-runtime
description: "How the Node side of a dev stack runs without haven, and the backend host: `pnpm dev` (UI built once, backend reloading), `pnpm dev:hmr` (adds the Vite ui lane), tools/dev-runtime (api + worker in one Node process), backend reload on a file change, the debounce (quiet window + max wait), ports derived from PORT. Use when someone says 'pnpm dev', 'dev:hmr', 'dev:backend', 'the backend lane', 'backend reload', 'why did the api restart', 'reload storm', 'ADR-168', 'dev-runtime', 'backend ready', or 'LANGWATCH_DEV_WATCH'. ADR-168 is Accepted; since 2026-10-10 Vite runs only under --hmr, as its own lane."
user-invocable: true
argument-hint: "[dev | dev:hmr | reload | ports]"
---

# dev-runtime and the backend host

`tools/dev-runtime` (`@langwatch/dev-runtime`) is contributor-only. It hosts the api and the
worker of a local stack in one Node process so no app carries a dev branch (record §1).
Production still runs each app's own `main.ts`, and the helm chart runs api, worker and tasks
as split apps.

**Status of ADR-168** (`dev/docs/adr/168-one-process-dev-with-debounced-module-reload.md`):
`Accepted`. The amendment of 2026-10-10 removed the in-process Vite UI host (`dev:one`):
Vite runs in dev only under `--hmr`, as its own `ui` lane beside the backend. The open
questions at the foot of the ADR that remain are Alex's, not answered.

## The two shapes

| Shape    | Lanes                                                         | Start          | haven equivalent               |
| -------- | ------------------------------------------------------------- | -------------- | ------------------------------ |
| Built UI | `backend` (api + worker, serving the built UI on `PORT`)      | `pnpm dev`     | `haven up`, `haven up --watch` |
| HMR      | `ui` (Vite on `PORT`) + `backend` (api + worker, `PORT+1000`) | `pnpm dev:hmr` | `haven up --hmr`               |

- `pnpm dev` runs `dev/scripts/dev-stack.sh`, which runs the lanes through `concurrently`:
  `ui` (only `--hmr`), `go`, `langy`, then `backend`. It runs the upgrade
  (`start:prepare:db`, `pnpm task upgrade`) once before any lane starts, and without
  `--hmr` builds the UI once (`@langwatch/ui:build:local`, copied to
  `apps/ui/dist/client.dev`, served through `LANGWATCH_UI_DIST_DIR`). Run it from the root.
- Under haven a still or `--watch` stack names the backend lane `app`; an `--hmr` stack
  names it `api` beside a `ui` lane. `LANGWATCH_DEV_ONE_PROCESS=0` now only splits the
  simulators out of the `go` lane (`LANGWATCH_GO_ONE_PROCESS` is its deprecated alias).
- Other scripts in the root `package.json`: `dev:ui`, `dev:api`, `dev:worker`,
  `dev:backend` (api + worker, one process), `dev:go`, `dev:cli` (the npx CLI, see
  `server-cli`). Use `dev:api` plus `dev:worker` for performance work: one event loop
  skews timings.

## What the host does (`tools/dev-runtime/src`)

- `app.entrypoint.main.ts`: holds `API_PORT`, loads api and worker through a Vite module
  runner and re-links them in process (`pnpm --filter @langwatch/dev-runtime dev`). It
  hosts no UI. The `dev` script's loop restarts it only when it exits 75 (a recycle). An
  edit to the host's own `src/` (Node loaded it natively) applies on the next restart.
- `backend.reload.ts`: finds the loaded modules a changed file reaches
  (`staleModuleIds`) and drops only those; reloads are debounced, never held.
- `backend.process.ts`: `startBackend` boots the api and the worker together (the api never
  waits on the upgrade and holds no request: a Postgres read ahead of the schema answers
  `upgrade_in_progress`, NO-HOLDS); `drainBackend` stops the worker first, then the api.
  Another lane is moving this seam into a shipped `apps/backend` (ADR-168 open question 3).

A backend edit that touches a loaded file re-links, boots the new api beside the old one,
moves `API_PORT` to it and drains the old generation. A change that does not link leaves the
old generation serving. A failed boot retries on its own and on the next change. Each
generation logs one `backend ready` line: generation number, changed files, `swapMs`,
`readyMs`, `rssMiB`.

## Reload knobs

| Variable                            | Effect                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `LANGWATCH_DEV_WATCH=0`             | still: no reload on a change; `haven reload` (SIGUSR2) applies them (haven sets it unless `up --watch`/`--hmr`) |
| `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`   | quiet window before a reload (2000)                                                                             |
| `LANGWATCH_DEV_WATCH_MAX_WAIT_MS`   | never defer longer than this after the first change (30000)                                                     |
| `LANGWATCH_DEV_RECYCLE_GENERATIONS` | after this many generations, the next edit restarts the process (50)                                            |
| `LANGWATCH_DEV_RECYCLE_RSS_MIB`     | past this RSS, the next edit restarts the process (8192)                                                        |

There is no agent-turn hold (retired 2026-10-09, ADR-168): the debounce alone coalesces a
turn's edits, and `haven hmr` no longer exists. A skipped change is `.md`, `.mdx`, `.feature`, a `tsconfig*.json`,
a `.json` outside `src/`, or a package the watched command cannot reach. The authority for
this is `tools/dev-runtime/src/app.entrypoint.main.ts` (the supervisor script is gone, ADR-168 amendment 2026-10-10).

## Ports

All derive from `PORT` (default 5560) in `dev/scripts/lib/derive-dev-ports.sh`: ui `PORT`,
api `PORT+1000` (`PORT` under plain `pnpm dev`, which has no ui lane), gateway `PORT+3`, worker metrics `PORT-2561`; `dev/scripts/dev-stack.sh`
adds the Redis DB index `(PORT-5560)/10`. An explicit `API_PORT` or `WORKER_METRICS_PORT` wins. Two stacks need
two `PORT`s (5570, 5580, ...). A held port stops the launcher with a line saying which.
Under `pnpm dev:hmr` the mail preview runs inside the ui dev process on `PORT+6`, started on
first visit and closed after idle; `LANGWATCH_MAIL_PREVIEW_SPAWN=1` runs it as its own process instead.

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
- What it showed (2026-10-10, when the host still ran the UI's Vite server in-process):
  - RSS is about 2.7 GB, of which about 1.5 GB is JS heap (500 MB of it large objects). A boot takes about 40 s (`readyMs`).
  - At rest the process is about 90% idle, so the boot is the CPU cost.
  - Most of the heap was loaded code: the module runner kept each backend module's transformed code with an inline base64 source map, beside the map in Vite's module graph and V8's own copy (fixed, see below).
  - `modules/analytics/contract/src/visualization/vega-lite-schema-validator.generated.js` is 8 MB on disk and evaluates as a 41M-char script.
  - The other big ones: sass, the prisma client, `@clickhouse/parser`, `model-catalog.json` and `lwql-prisma-manifest.generated.json`.
- Since the amendment of 2026-10-10 the host never runs the UI's Vite server.
- Inline source maps are off since 2026-10-10 (`startBackendVite`, `createBackendRunner`): each evaluation gets `//# sourceURL=<id>?lw=<n>` and stack traces map through the maps Vite's module graph already holds, so a frame still reads `throws.ts:12:9`, also after an edit. Backend-only import A/B (`.claude/tmp/prof/srcmap/boot.mjs base|lane`):

  |                      | heap after GC | RSS after GC |
  | -------------------- | ------------- | ------------ |
  | inline maps (before) | 1108 MB       | 2873-3097 MB |
  | no inline maps (now) | 503-506 MB    | 1938-2392 MB |

  Boot times from that run are void (load average 25-68); an earlier quiet run measured 21.4 s -> 18.2 s.

## Where to read next

`dev/docs/LOCAL_STACK.md` (processes, the backend host section), `specs/setup/dev-process-topology.feature`
(the requirements), `dev/docs/best_practices/dev-log-format.md` (lane log columns), the
`haven` skill for the supervised stack.
