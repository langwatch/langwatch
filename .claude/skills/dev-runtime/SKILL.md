---
name: dev-runtime
description: "How the Node side of a dev stack runs without haven, and the one-process lane: `pnpm dev`, `pnpm dev:one`, `LANGWATCH_DEV_ONE_PROCESS=1`, tools/dev-runtime (ui + api + worker in one Node process), backend reload on a file change, the debounce and agent-turn hold, ports derived from PORT. Use when someone says 'pnpm dev', 'dev:one', 'one process', 'the app lane', 'backend reload', 'why did the api restart', 'reload storm', 'ADR-168', 'dev-runtime', 'backend ready', or 'LANGWATCH_DEV_WATCH'. ADR-168 is Proposed, not accepted."
user-invocable: true
argument-hint: "[dev | dev:one | reload | ports]"
---

# dev-runtime and the one-process lane

`tools/dev-runtime` (`@langwatch/dev-runtime`) is contributor-only. It hosts the Node
applications of a local stack so no app carries a dev branch (record §1). Production still
runs each app's own `main.ts`, and the helm chart runs api, worker and tasks as split apps.

**Status of ADR-168** (`dev/docs/adr/168-one-process-dev-with-debounced-module-reload.md`):
`Proposed`, dated 2026-09-30. Its step 1 (the supervisor trigger fixes) and B1 (the host)
have landed as a trial; the four open questions at the foot of the ADR are Alex's, not
answered. Teach it as a trial. Do not call it the accepted design, and do not make a
change that depends on it being the default.

## The two shapes

| Shape | Node processes | Start | Reload |
| --- | --- | --- | --- |
| Split (default) | `ui` lane (Vite) + `backend` lane (api and worker in one `node`) | `pnpm dev` | `dev-supervisor.mjs --watch` restarts the whole backend process |
| One process (trial) | one `app` lane: Vite, api and worker | `LANGWATCH_DEV_ONE_PROCESS=1 pnpm dev`, or `pnpm dev:one` alone | re-links only what a change reaches, in process |

- `pnpm dev` is `dev-supervisor.mjs` over `dev/scripts/dev-stack.sh`, which runs the lanes
  through `concurrently`: `ui`, `go`, `langy`, then `backend` (or `app`). It migrates once
  before any lane starts. Run it from the root.
- Under haven the same switch applies: `LANGWATCH_DEV_ONE_PROCESS=1` in the environment or
  `.env`, then `haven up -f`. `haven logs ui|api|worker` then read the one `app` capture,
  and `haven restart ui` or `api` restarts the whole process (`dev/docs/LOCAL_STACK.md`,
  section "One process").
- Other scripts in the root `package.json`: `dev:ui`, `dev:api`, `dev:worker`,
  `dev:backend` (api + worker, one process), `dev:go`, `dev:cli` (the npx CLI, see
  `server-cli`). Use `dev:api` plus `dev:worker` for performance work: one event loop in
  `dev:one` skews timings.

## What the host does (`tools/dev-runtime/src`)

- `app.entrypoint.main.ts`: starts the UI's Vite server (`apps/ui/vite.config.ts`,
  unchanged, `/api` still proxied) and loads api and worker through a Vite module runner.
- `backend.entrypoint.main.ts`: the split shape's backend, api and worker in one Node
  process; prints `backend ready` so the supervisor knows a boot settled.
- `backend.reload.ts`: finds the loaded modules a changed file reaches
  (`staleModuleIds`) and drops only those; honours the agent-turn hold.
- `backend.process.ts`: `startBackend` boots the worker first, then the api;
  `drainBackend` stops them in the reverse order.

A backend edit that touches a loaded file re-links, drains the old generation and boots the
new one; the browser keeps its HMR socket. A change that does not link leaves the old
generation serving. A failed boot waits for the next change. Each generation logs one
`backend ready` line: generation number, changed files, `drainMs`, `readyMs`, `rssMiB`.

## Reload knobs

| Variable | Effect |
| --- | --- |
| `LANGWATCH_DEV_WATCH=0` | one-shot, no reload (diff tools measure a stack that must not move) |
| `LANGWATCH_DEV_WATCH_DEBOUNCE_MS` | quiet window before a reload (2000) |
| `LANGWATCH_DEV_WATCH_MAX_WAIT_MS` | never defer longer than this after the first change (30000) |
| `LANGWATCH_DEV_HOLD_MARKER` | override the `apps/ui/.haven-hmr-gate` marker path |

The hold marker is what `haven hmr on --ttl 60s` writes during an agent turn; a reload
waits for it, at most 60 s. A skipped change is `.md`, `.mdx`, `.feature`, a `tsconfig*.json`,
a `.json` outside `src/`, or a package the watched command cannot reach. The authority for
these is `dev/scripts/dev-supervisor.mjs` and ADR-168 "Step 1, as shipped".

## Ports

All derive from `PORT` (default 5560) in `dev/scripts/lib/derive-dev-ports.sh`: ui `PORT`,
api `PORT+1000`, gateway `PORT+3`, worker metrics `PORT-2561`, Redis DB index
`(PORT-5560)/10`. An explicit `API_PORT` or `WORKER_METRICS_PORT` wins. Two stacks need
two `PORT`s (5570, 5580, ...). A held port stops the launcher with a line saying which.

## Failure shapes

- A reload storm after a burst of agent writes: raise the debounce, or turn the hold hook
  on (`haven hmr on`); the log names the changed files per generation.
- `fatal boot failure` after an edit: the old generation is gone in the split shape (two
  Node processes cannot share a port), and the supervisor waits for the next change.
  Fix the file; do not restart the lane.
- Memory growing over many generations (one-process only): note `rssMiB` per
  `backend ready` line; a restart is the guardrail. Report it, since it is an ADR-168 risk.

## Where to read next

`dev/docs/LOCAL_STACK.md` (processes, one process section), `specs/setup/dev-process-topology.feature`
(the requirements), `dev/docs/best_practices/dev-log-format.md` (lane log columns), the
`haven` skill for the supervised stack.
