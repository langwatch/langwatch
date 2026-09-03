# Core application extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Hand-off checkpoint:** `1956fe0c06`

This is the short restart guide. The detailed and authoritative execution
ledger is the [platform application exit plan](core-application-feature-extraction-plan.md).
Accepted ADRs, feature ADRs/specs, the feature catalogue and the nearest
`AGENTS.md` remain authoritative.

## Read and operate

Before a broad inventory use `feature-inventory`. Use `feature-migration` for
each app-to-package cut and `feature-migration-review` before staging it. Work
in this branch and shared tree, stage exact paths or hunks, commit coherent
slices, and delete displaced production code only when the replacement is live
and parity-proven.

The target is physical separation:

- `apps/api` owns HTTP, REST, tRPC and request policy;
- `apps/worker` owns Eventing, queues, process managers and scheduled work;
- `apps/ui` owns browser boot, providers, routing and page composition; and
- feature packages own their portable contract, canonical server behaviour and
  reusable web behaviour.

Do not copy `platform/app/src/server/app-layer`. Replace it with one explicitly
composed service graph per process.

## Committed state

The current coordinated sequence is:

| Commit       | Result                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| `02457aaebd` | Agent and Secret tRPC behaviour moved to package adapters.                         |
| `39f1de6dff` | Topic manual execution now dispatches durable Eventing commands.                   |
| `0d877db1d7` | Worker shutdown drains Eventing/features before infrastructure and observability.  |
| `589a251194` | The Go OpenAPI comparator rejects path-prefix and reference edge cases.            |
| `eab4d6fd6e` | Chunk recovery moved from the old app to UI behaviour.                             |
| `f1baea7011` | API listener, typed config, request policy and bounded drain are callable.         |
| `f9dbf94c8a` | Standalone API mounts package Secret REST on all four required bases.              |
| `cd28835a7b` | Trace processing and Dataset auxiliary jobs moved to a package Eventing installer. |
| `1956fe0c06` | UI global/private hierarchy is enforced; `apps/ui/src/app` is gone.                |

At this checkpoint `platform/app` has 6,305 tracked files, 5,949 under `src`.
Only committed deletion changes those counts.

## Live boundaries and remaining work

### API

`apps/api` has a real Node/Hono listener with graceful drain. It serves the
package Agent/Secret tRPC adapters and Secret REST at:

- `/api/v1/secret`
- `/api/v1/secrets`
- `/api/secret`
- `/api/secrets`

Collection GET/POST and item GET/PUT/DELETE are covered on every base. A missing
version selects v1, `X-API-Version: v1` is accepted, and unsupported or
conflicting versions are rejected.

This is not yet the live API process. It has no executable boot and no concrete
session, project-key, PAT/admin, API-key ceiling/mark-used, rate-limit or audit
adapters. The universal platform tRPC root and platform REST graph remain live.
The legacy `/api/secrets` route also retains credential-derived project
selection and legacy payload, error and deprecation behaviour that the modern
direct mount does not yet reproduce.

### Worker and Eventing

Topic runs through Eventing. Trace now owns registration of `assignTopic`,
deferred origin resolution and the existing Dataset normalisation job. The
legacy registry composes that installer, and the dead app-side Trace topic
command bridge is deleted. Dataset durable payloads have a contract Zod schema
and are parsed at the worker boundary.

The new worker remains producer-only. `event-sourcing/jobs` is one shared queue,
so a partial consumer would reject and redeliver jobs from all unmounted
pipelines. Move the remaining registry groups and concrete EventStore,
ProcessStore, Group Queue, Redis, Prisma, ClickHouse and external effect
composition before enabling consumers or deleting the live worker.

### UI

`apps/ui` now permits only global `model`, `behavior`, atomic
`ui/{elements,blocks,sections}`, `screens`, `surfaces`, and private
`features/<feature>/{model,behavior,ui}`. Dependency direction is linted and the
old `app`, `platform` and `testing` roots are rejected. Runtime behaviour, shell
sections, chunk recovery and Agent browser transport follow this layout.

The live browser entry, provider graph, routes, overlays and most pages still
belong to `platform/app`, notably `pages/_app.tsx`, `routes.tsx`,
`AppProviders.tsx` and `runtime/ui/legacy-ui-shell.adapter.tsx`. Preserve that
thin adapter until boot, provider order, URL and overlay parity are proven.

### OpenAPI

The checked-in documents are stale. The semantic comparison with `main` finds
129 changed operations, 30 added and five removed. The five removed operations
are exactly GET/POST `/api/secrets` and GET/PUT/DELETE `/api/secrets/{id}`.
Generation still imports the platform route graph and currently fails before
route composition because executable environment configuration is not
initialised. Record this as generator ownership work; do not paper over it by
editing generated JSON.

### Global application and configuration

`server.mts`, `start.ts`, `task.ts`, instrumentation, runtime/public config,
the complete API graph, the complete worker registry and about 191 production
files under `server/app-layer` remain. Identity/access, full Trace behaviour,
most transports, most UI, infrastructure clients, Enterprise composition and
operational tooling still depend on them.

## Next dependency-closed tranches

1. Add executable API boot plus concrete identity/API-key/AuthZ/audit adapters,
   then migrate transport verticals without copying the global App.
2. Move the remaining Eventing registry groups and durable infrastructure into
   the worker; enable the consumer only when the shared registry is complete.
3. Move browser boot/providers/router into `apps/ui`, then drain route families
   through feature-web screens and narrow surfaces.
4. Establish canonical identity/access ownership early because every later API
   and UI vertical depends on it.
5. Move OpenAPI generation and serving with the complete API graph, initialise
   task config explicitly, regenerate, and explain every diff from `main`.
6. Continue feature verticals and delete each displaced platform path in the
   same reviewed commit.

## Decisions approaching

- Preserve the exact legacy `/api/secrets` envelope indefinitely, or make an
  explicit compatibility change before retiring it.
- Continue with one complete shared Eventing registry, the current and simpler
  compatibility path, or deliberately partition queues and routing.
- Choose the first provider/router tranche that gives `apps/ui` a real browser
  entry without combining it with a visual redesign.
- Confirm the canonical identity split between catalogue features and shared
  identity infrastructure before moving Better Auth/session ownership.
- Align the LangWatch SDK/OTel ownership used by API, worker and legacy
  instrumentation before executable cutover.

## Current proof and known red checks

Focused API, Worker, Trace, Dataset, UI and architecture suites pass at the
checkpoint. The main ledger records exact test counts and follow-ups. Full
platform/workspace architecture and comment checks still report unrelated
shared-tree syntax, stale baseline and long-comment diagnostics. Report those
checks as red, keep the exact diagnostic, and continue dependency-closed work
without calling them green or broadening an unrelated slice.
