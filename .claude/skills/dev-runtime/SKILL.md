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

| Shape               | Node processes                                                   | Start                                                           | Reload                                                      |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Split               | `ui` lane (Vite) + `backend` lane (api and worker in one `node`) | `LANGWATCH_DEV_ONE_PROCESS=0 pnpm dev`                          | re-links only what a change reaches, in process (see below) |
| One process (default) | one `app` lane: Vite, api and worker                             | `pnpm dev`, or `pnpm dev:one` alone                             | re-links only what a change reaches, in process             |

- `pnpm dev` is `dev-supervisor.mjs` over `dev/scripts/dev-stack.sh`, which runs the lanes
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
@langwatch/dev-runtime dev`), the same host without the UI's Vite server. The supervisor
  keeps the process: it restarts it only for a `package.json`, a file in the host's own
  `src/` (Node loaded both natively), or a crash after `backend ready`.
- `backend.entrypoint.main.ts`: api and worker in one Node process with no reload
  (`pnpm start`, and the `LANGWATCH_DEV_RELOAD=process` fallback's boot shape).
- `backend.reload.ts`: finds the loaded modules a changed file reaches
  (`staleModuleIds`) and drops only those; reloads are debounced, never held.
- `backend.process.ts`: `startBackend` boots the worker first, then the api;
  `drainBackend` stops the worker first, then the api.

A backend edit that touches a loaded file re-links, drains the old generation and boots the
new one; the browser keeps its HMR socket. A change that does not link leaves the old
generation serving. A failed boot waits for the next change. Each generation logs one
`backend ready` line: generation number, changed files, `drainMs`, `readyMs`, `rssMiB`.

## Reload knobs

| Variable                            | Effect                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `LANGWATCH_DEV_WATCH=0`             | one-shot, no reload (diff tools measure a stack that must not move)            |
| `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`   | quiet window before a reload (2000)                                            |
| `LANGWATCH_DEV_WATCH_MAX_WAIT_MS`   | never defer longer than this after the first change (30000)                    |
| `LANGWATCH_DEV_RELOAD=process`      | api lane: back to the supervisor's whole-process restart per change            |
| `LANGWATCH_DEV_RECYCLE_GENERATIONS` | api lane: after this many generations, the next edit restarts the process (50) |
| `LANGWATCH_DEV_RECYCLE_RSS_MIB`     | api lane: past this RSS, the next edit restarts the process (4096)             |

There is no agent-turn hold (retired 2026-10-09, ADR-168): the debounce alone coalesces a
turn's edits, and `haven hmr` is a no-op. A skipped change is `.md`, `.mdx`, `.feature`, a `tsconfig*.json`,
a `.json` outside `src/`, or a package the watched command cannot reach. The authority for
these is `dev/scripts/dev-supervisor.mjs` and ADR-168 "Step 1, as shipped".

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

## Where to read next

`dev/docs/LOCAL_STACK.md` (processes, one process section), `specs/setup/dev-process-topology.feature`
(the requirements), `dev/docs/best_practices/dev-log-format.md` (lane log columns), the
`haven` skill for the supervised stack.
