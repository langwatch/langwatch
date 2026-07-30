# ADR-102: The core is a package, the pipelines are the application

**Date:** 2026-07-29

**Status:** Accepted — the boundary rule is in force and enforced by a test; the
directory move itself is not yet made.

**Related:** ADR-098 (the core semantics this package encloses — commands,
events, projections, subscribers, process managers), ADR-099 (the storage layer
and `defineTable`, which ship inside the package), ADR-100 (the dispatch plane,
also inside), ADR-101 (replay, whose executor is in the package but whose preset
is application code), ADR-103 (runs — a pipeline, and therefore application
code), ADR-104 (the ClickHouse client, which the package consumes as an injected
port and does not own).

## Context

The event-sourcing tree is the largest single subsystem in the app.
`langwatch/src/server/event-sourcing/` holds 369 non-test files and 69,879
lines, plus 320 test files and 94,626 lines of tests. Two thirds of that is not
the core: `pipelines/` alone is 240 files and 37,593 lines of source with 172
test files behind it, spread over 13 pipelines from `trace-processing` (63 files,
12,665 lines) down to `blob-maintenance` (2 files, 161 lines). The core —
everything outside `pipelines/` — is 129 files and 32,286 lines.

Those two halves are different kinds of code. The core defines a vocabulary:
`Event`, `TenantId`, `Command`, `definePipeline`, the fold and map projection
contracts, the GroupQueue, the process runtime. The pipelines are 13 concrete
domain models expressed in that vocabulary. They are versioned by product
decisions; the core is versioned by correctness decisions. Nothing in the
directory layout says so, so nothing stops a core primitive reaching into a
pipeline — and one does:
`projections/foldStore/defineFoldStore.ts:2` imports `retentionDaysFrom` from
`pipelines/shared/analyticsStoreBase`, which makes the generic fold-store
definition depend on a pipeline helper.

The interesting measurement is how far the core is from being extractable. Every
import statement in the core (excluding `pipelines/` and tests) whose target
resolves outside `event-sourcing` was counted, resolving `~/`, `@ee/` and
relative specifiers alike: 122 statements against 75 distinct modules. But 53 of
those 122 are in one file, `pipelineRegistry.ts`, and a further 5 are in
`replay/replayPreset.ts` and `introspection.ts`. All 3 files are composition
roots — they name concrete repositories, services and stores and wire them
together. They are application code that happens to live in the core directory.

That leaves 6 genuine leaks and 58 statements that are ports the core legitimately
needs. The package boundary is far closer than 69,879 lines suggests.

## Decision

### 1. The core moves to `packages/event-sourcing`; the 13 pipelines stay in the app

`packages/event-sourcing` holds the core: domain types, commands, the pipeline
builder, projection contracts and executors, the storage layer of ADR-099, the
dispatch plane of ADR-100, the replay executor of ADR-101, the process-manager
runtime, and their tests. It is a source-only workspace package in the shape
`packages/langy` already has — `exports` pointing at `./src/*.ts`, `files:
["src"]`, `emitDeclarationOnly`, peer-dep'd on `zod` so it compiles against the
app's own copy.

`langwatch/src/server/event-sourcing/pipelines/` becomes
`langwatch/src/server/pipelines/`. It is the application.

The root `pnpm-workspace.yaml:2` already lists `packages/*`, so the package is
resolved there without change. The app is its own workspace and must name the
package explicitly, exactly as it names its two existing siblings at
`langwatch/pnpm-workspace.yaml:7` and `:15`. The package's `tsconfig.json`
follows `packages/langy/tsconfig.json:9-10` — `"incremental": true` with
`"tsBuildInfoFile": "node_modules/.cache/tsbuildinfo/event-sourcing.tsbuildinfo"`
— and not `packages/handled-error/tsconfig.json:10`, which writes its build info
into `./dist` and so loses it on every clean.

### 2. The package may not import application code, and a test says so

The boundary is a test in the package, not a convention in a docblock. It walks
every `.ts` file under `packages/event-sourcing/src`, resolves every import
specifier, and fails on any that leaves the package other than to a declared
dependency. `~/`, `@ee/` and `../../../langwatch/src` all fail. Anything the core
needs from the app is an injected port declared in the package's own types.

The 122 outbound statements classify into 3 buckets, and the sizes are the
argument:

| Bucket | Statements | Where |
|---|---|---|
| Composition root — application code already | 58 | `pipelineRegistry.ts` (53), `replay/replayPreset.ts` (4), `introspection.ts` (1) |
| Genuine leaks — fixed, not ported | 6 | listed in §3 |
| Legitimate injected ports | 58 | 19 modules in 8 families |

The 8 port families, with the statement counts that justify each being a port
rather than a copy: retention policy 16 (`data-retention/retentionPolicyResolver`
8, `retentionPolicy.schema` 8), feature flags 14, metrics 8, stored objects 6,
`utils/zod` plus `utils/constants` 5, ClickHouse client 2, tenant rate tracker 2,
and 5 singletons — Redis, async context, `queues/makeQueueName`,
`app-layer/config`'s `roleRunsWorkers`, PostHog error capture. Each becomes an
interface in the package and an argument at the composition root. The retention
schema and the feature-flag registry are the 2 that need care, because they are
enumerations the app owns and the core switches on; both cross as an opaque
resolver function, never as the enum.

### 3. Storage is a second package, and the core depends on contracts only

`defineTable`, the positional codec and the single ClickHouse client (ADR-099,
ADR-104) live in `langwatch/packages/clickhouse`, not in the event-sourcing
package. Two reasons, and the first is structural rather than tidy.

**The core would stop being pure.** A package that declares `defineTable` carries
a ClickHouse dependency, and the boundary test in decision 2 would fail — as it
should. What the core declares instead are the store *contracts*: load a state,
store a state, append records, append a batch. The ClickHouse package implements
them; so does Postgres, which is not a hypothetical — an operational fold already
keeps its state in a Postgres row, and a core that knew about ClickHouse would
have made that adopter the exception rather than an ordinary case of the same
interface.

**ClickHouse has consumers that are not event-sourced.** The analytics query
builders, the governance services under `ee/`, and the ops explain paths all read
ClickHouse without touching a projection. If the table definitions lived in the
event-sourcing package, those callers would either be unable to use them or would
take an event-sourcing dependency to run a query. The first duplicates the query
surface the definitions exist to remove; the second makes the dependency graph
say something untrue about the system.

So the layering is four, each depending only on the one above:

| layer | home | owns |
| --- | --- | --- |
| event-sourcing core | `packages/event-sourcing` | aggregates, projection execution, group keys, store **contracts** |
| storage | `packages/clickhouse` | `defineTable`, codec, the client, ClickHouse **implementations** of those contracts |
| repositories | `app-layer/<domain>/repositories` | domain reads and writes, built on the storage package |
| pipelines | `event-sourcing/<name>/` | the domain's commands, events and projections |

The two packages do not depend on each other. The application wires them
together, which is what a composition root is for (decision 6).

That ordering is also the migration order, and it is forced rather than chosen:
no repository can move to the new client before the storage package exists, and
no pipeline can be rewritten before its repositories have. The storage package is
therefore on the critical path for everything downstream, and it is the larger
piece — 33 table definitions, 7 client construction sites collapsing to 1, and a
wire-format change on every read and write in the application.

### 4. Six leaks are fixed before the move, not carried through it

- `replay/replayExecutor.ts:1` and `services/eventSourcingService.ts:5` both
  import `leanForProjection` from `app-layer/traces/lean-for-projection`. A
  trace-specific payload trimmer is not a core concern; it becomes a per-pipeline
  hook the pipeline supplies.
- `queues/groupQueue/tieredBlobStore.ts:6` imports the trace constant
  `COMMAND_INLINE_THRESHOLD` from the same module and assigns it to
  `S3_TIER_THRESHOLD_BYTES` at line 39. A generic blob store sizes its own tiers;
  the number is configuration, not an import from a domain.
- `projections/global/orgBillableEventsMeter.store.ts:2-3` imports
  `clickhouseClient` and `resolveOrganizationId`, and its sibling
  `orgBillableEventsMeter.mapProjection.ts:2-5` imports event-type constants from
  4 separate pipelines. This is a billing projection living inside the core. It
  moves out to a pipeline, where a projection that spans 4 event vocabularies
  belongs.
- `schemas/typeIdentifiers.ts:28` imports `@ee/event-sourcing/typeIdentifiers`,
  and lines 7-27 import type constants from 10 pipelines. A core module that
  enumerates every pipeline's event types is an inverted dependency with a name
  that hides it. The enumeration is assembled at the composition root from the
  pipelines that register, not compiled into the core.

`defineFoldStore.ts:2` is the fifth inverted import and is fixed the same way:
`retentionDaysFrom` becomes part of the retention port.

Counting inverted imports separately — core modules importing from `pipelines/` —
gives 59 statements, and the same concentration holds: 44 are in the 2
composition roots and travel with them, 15 are the leaks above.

### 5. A pipeline is one file, in layers, with dependencies pointing downward

Each of the 13 pipelines owns a directory with `commands/`, `projections/`,
`subscribers/`, `process-manager/` and `schemas/` beneath a single `pipeline.ts`.
That file states the whole topology and nothing else: a `Deps` interface naming
every collaborator as a type, then one function that calls `definePipeline` and
registers each member by constructing it from an imported factory.
`pipelines/trace-processing/pipeline.ts` is the reference — 341 lines, its deps
interface at line 77, its builder at line 176, and every mount below that a
factory call rather than an injected value.

The rule that makes the file readable is that a mounted member is *constructed
there*, not passed in. A pipeline whose projections arrive through `Deps` states
its wiring somewhere else, and the one file stops being the answer to "what does
this pipeline do". The single acknowledged exception is enterprise members: `ee/`
cannot be imported unconditionally from an open-source pipeline file, so the 5
enterprise mounts in `trace-processing` cross as injected values behind an
`if` guard. That exception is scoped to the OSS/EE boundary and is not a
precedent for injecting anything else.

Dependencies point downward only. `pipeline.ts` may import from its own
subdirectories, from `@langwatch/event-sourcing`, and from another pipeline's
`commands/` or `schemas/` when it dispatches across pipelines. A `projections/`
file may not import `pipeline.ts`.

### 6. The composition root is application code and assembles stores from repositories

`pipelineRegistry.ts` — 922 lines, `registerAll()` at line 268 — stays in the
app, and its 53 outbound imports stop being a boundary violation the moment the
boundary is drawn correctly. It is the only place that may name both a concrete
repository and a projection: it constructs each store by wrapping a repository
in the store kinds of ADR-099 and hands the result to a pipeline's `Deps`. Its
return type is the app's command surface —
`export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>` at
`pipelineRegistry.ts:922` — consumed by `app-layer/app.ts:3` and
`app-layer/dependencies.ts:12`, and driven from `app-layer/presets.ts:1018`.

`replay/replayPreset.ts` is the second composition root, for the offline replay
of ADR-101, and moves to the app beside the first.

### 7. Whether a process runs the runtime is one predicate, `roleRunsWorkers`

There are 4 process roles — `"web" | "worker" | "migration" | "all"`
(`app-layer/config.ts:4`) — and exactly one test for whether a role hosts the
worker stack: `roleRunsWorkers(role)` at `app-layer/config.ts:17`, true for
`"worker"` and `"all"`. No site compares `processRole` to a string literal. All
11 non-test call sites use the function, including the 2 inside the core that
gate consumers: `eventSourcing.ts:166` sets `consumersEnabled` on the process
runtime, and `eventSourcing.ts:609` sets `consumerEnabled` on the GroupQueue
processor. The scheduler uses the same test at
`app-layer/scheduler/scheduler.service.ts:169`, as do
`app-layer/presets.ts:838`, `:852`, `:996` and `:1022`.

Registration is unconditional; consumption is gated. Every role builds the same
pipeline graph, so introspection, command dispatch and type surfaces are
identical everywhere; only the consumer loops start where the predicate holds.

The 3 entry points are `initializeWebApp()` (`presets.ts:295`),
`initializeWorkerApp()` (`presets.ts:299`) and `initializeInProcessApp()`
(`presets.ts:310`). Production runs the first 2 as separate deployments:
`src/start.ts:142` for web, `src/workers.ts:35` for the worker, which then calls
`startWorkers({ shouldStartMetricsServer: true })` at `workers.ts:66`. The third
is dev-only — `start.ts:140` boots the `"all"` role when `WORKERS_IN_PROCESS=1`,
and `start.ts:419` hosts the worker stack in the web process with
`shouldStartMetricsServer: false`, because in one process the worker registry is
already served at `/metrics`.

## Rationale / Trade-offs

**Why the root `packages/`, not `langwatch/packages/`?** The app has its own
package set — 7 of them, `observability`, `api`, `ssrf` and the rest — and they
are app-internal utilities that ship with the app build. The root set holds
contract packages: `handled-error` and `langy` are both source-only, both
peer-dep'd, and both consumed by more than the app. The event-sourcing core is
the second kind. It defines the vocabulary anything agreeing with `event_log`
must speak, and putting it under `langwatch/` would place it inside the tree it
is not allowed to import from, where a relative path back up into `src/` is 3
segments away and only the boundary test stands between. Neither existing set
currently leaks, so this is a decision about kind, not a repair.

**Why a wide `exports` map rather than a single entry point?** 193 import
statements reach into the core from outside it — 180 aliased deep paths, 12
relative, and exactly 1 through the aliased root entry — spread across 13
subpath families (`projections` 42, `pipeline` 37, `queues` 30, `utils` 17,
`services` 16, `domain` 15, and the tail). `index.ts` is 96 lines and already
re-exports the intended surface, including `definePipeline` at line 45.
Collapsing 192 deep imports onto it in the same change would fold a semantic
question — what is public — into a mechanical move, and any import the barrel
does not already cover would be added under time pressure. The `exports` map
mirrors the current subpaths, and narrowing it is separate work with its own
test.

**Why move at all, when the residual coupling is only 58 port statements?** The
same measurement is the reason: 58 is small enough that the boundary can be a
test rather than a review habit, and a test is the only thing that keeps it at
58. The tree grew to 69,879 lines with no mechanism preventing a core primitive
from importing a pipeline, and `defineFoldStore.ts:2` is what that costs — one
line, invisible in review, which makes the generic fold-store definition
un-extractable. Drawing the boundary now is cheap; drawing it after the next 5
such lines is not. A separate tsconfig also gives the core its own incremental
build, which the app's 12,000-file program does not.

**Why does a 922-line composition root not get split?** Because its length is
the honest size of the wiring, and splitting it distributes the answer to "what
is mounted in this deployment" across files that would each have to be read to
reconstruct it. Its 53 outbound imports are not a smell in a file whose job is
to name concrete collaborators; they are the job. What was wrong was its
location.

## Migration order

1. Fix the 6 leaks and the 5 inverted imports in place, in the app, before any
   file moves. Each is a behaviour-preserving change with its own test.
2. Move `pipelines/` to `langwatch/src/server/pipelines/`, and
   `pipelineRegistry.ts`, `replayPreset.ts` and `introspection.ts` beside it.
3. Create `packages/event-sourcing` with its `package.json`, `tsconfig.json` and
   `exports` map, add it to `langwatch/pnpm-workspace.yaml` and to the app's
   dependencies as `workspace:*`.
4. Move the remaining core, rewrite the 193 inbound imports to
   `@langwatch/event-sourcing`, and land the boundary test in the same commit as
   the move — a boundary test that arrives later starts from an unknown baseline.

## What does not move

- The 13 pipelines, and the ClickHouse client of ADR-104, which the package
  consumes through a port.
- The process roles and `roleRunsWorkers`. They are properties of the deployment,
  not of the core; the package receives a boolean.
- `ee/` pipelines and projections. The enterprise composition seam is unchanged
  by this decision, including the 5 injected enterprise mounts in
  `trace-processing/pipeline.ts`.

## Consequences

- The core gets a compile-time boundary it has never had. The class of defect
  that produced `defineFoldStore.ts:2` — a core primitive silently acquiring a
  pipeline dependency — becomes a failing test rather than a review catch.
- 193 import statements are rewritten. Every one is mechanical, and the single
  aliased root-entry import means there is no barrel to reconcile.
- The 6 leaks are fixed rather than ported, so 4 behaviours change slightly:
  the blob-store tier threshold becomes configuration, payload trimming becomes a
  per-pipeline hook, the billable-events meter becomes a pipeline projection, and
  the type-identifier enumeration is assembled at registration instead of at
  module load. The last of these removes a module-load-time dependency from the
  core onto all 13 pipelines.
- The app grows a second typecheck target. The package's own `tsc --noEmit` runs
  against 129 files instead of the app's whole program, so a core-only change is
  checked in a fraction of the time — but a change spanning both is checked
  twice, and CI grows a step.
- `pipelineRegistry.ts` remains a 922-line file with 53 imports. This ADR does
  not improve it; it stops mislabelling it. Anyone reading it as core code was
  reading it wrong.
- The `exports` map is deliberately wide, which means the package's public
  surface is currently whatever the app happened to import. Narrowing it is
  unstarted work, and until it is done the boundary test guards the direction of
  dependency but not the size of the interface.

## References

- `langwatch/src/server/event-sourcing/index.ts` — the 96-line surface that
  becomes the package's root export; `definePipeline` at line 45
- `langwatch/src/server/event-sourcing/pipelineRegistry.ts` — the composition
  root; `registerAll()` at line 268, `AppCommands` at line 922
- `langwatch/src/server/event-sourcing/pipelines/trace-processing/pipeline.ts` —
  the reference pipeline file; deps at line 77, builder at line 176
- `langwatch/src/server/app-layer/config.ts:4,17` — `ProcessRole` and
  `roleRunsWorkers`
- `langwatch/src/server/app-layer/presets.ts:295,299,310,1018` — the 3 entry
  points and the registry call
- `langwatch/src/workers.ts:35,66` and `langwatch/src/start.ts:140,142,419` —
  the worker and web boots
- `packages/langy/tsconfig.json:9-10`, `packages/langy/package.json` — the
  package shape the new package follows
- `pnpm-workspace.yaml:2`, `langwatch/pnpm-workspace.yaml:7,15` — the two
  workspaces and how a root package is named by the app
- ADR-098, ADR-099, ADR-100, ADR-101, ADR-103, ADR-104
