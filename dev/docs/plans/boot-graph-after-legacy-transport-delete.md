# The boot graph after the legacy transport delete

Written 2026-09-09 by the boot-graph lane, on `feat/strict-feature-layout-v0`.

## TL;DR

The seven legacy transport builders were deleted from `@langwatch/api`. The
deletion took **the whole tRPC surface** with it: every `*.api.ts` in every
module's `transport/api-trpc/` still names `createTrpcService`, and every
`apps/api/src/features/*/*-trpc.mount.ts` still names `appTrpcPolicy`,
`createTrpcApiService`, `createTrpcRouter` or `declaredPolicy`. None of those
survive in the package, so nothing that reaches them can be loaded.

What I did: made the three process graphs load again by cutting every dead edge,
never by re-exporting or stubbing. `apps/tasks` loads. `apps/api` and
`apps/worker` are one edge each from loading, and **both remaining edges belong
to other lanes** (see "Where I stopped").

REST is unaffected in shape but not in truth: the REST families still call
`security.createProjectVersionedApp(...)` on an object that no longer has that
method. They **load**; they will fail when a family is BUILT. That is the next
lane's work, not this one's.

## The shape it is in now

```
                      @langwatch/api
                     /              \
              ./rest                 ./trpc
        defineRestRouter          defineTrpcRouter
        createRestRuntime         createTrpcRuntime
                |                        |
        (families still call      (nothing reaches this;
         the DELETED builder       every transport still
         on the security object)   names the deleted one)
                |                        |
        loads, fails at build      not on any graph
```

- **tRPC: zero namespaces mounted.** `ApiTrpcFeaturesComposition` is gone;
  `api-production.composition.ts` composes `features = undefined` and logs the
  absence once through the existing `LoggedApiTrpcFeaturesAbsence`, with a new
  reason `unconverted-transports`. `NoApiTrpcFeatures` already existed for
  exactly this, so nothing new was invented.
- **REST: unchanged and mounted**, except `/api/dataset/generate`, whose mount
  file was already deleted; the authoring composition reports it absent by name.
- **Twenty-two module `server/src/index.ts` files** no longer export their tRPC
  transports. The transport files are all still on disk, untouched, for the
  conversion lanes to lift from.

## Good

- The cut is at exports and mounts, not at implementations. Every transport file
  is intact; converting one is still a matter of rewriting that file and putting
  its export back.
- Every absence is *named* through machinery that already existed
  (`ApiTrpcCollaboratorsAbsence`, `ApiAuthoringRestAbsenceReport`), not a new
  refusing twin.
- `apps/tasks` is fully green, so `pnpm start:prepare:db` works again. The fix
  there was real, not a cut: `dataset-content-backfill.composition.ts` now
  builds `PrismaDatasetMigrationRepository` itself through a new
  `@langwatch/dataset-server/composition/dataset-migration` subpath, exactly the
  way `object-storage-migrate.composition.ts` builds its ClickHouse repository.

## Bad — leftovers I created, deliberately

1. **`apps/api/src/app-trpc/app-trpc.features.ts` is now unreachable and red.**
   It is the one list of every tRPC namespace. Keep it: it is the conversion
   lane's checklist. Nothing imports it.
2. **Twenty-one `apps/api/src/features/*/*-trpc.mount.ts` are unreachable and
   red.** Same reason. Each is ~20 lines and is the shape the converted mount
   replaces.
3. **Process-side tRPC ports were deleted, not parked.** `organizationPorts`
   (~220 lines), `workflow` lifecycle + optimization ports (~190),
   `experiment` ports (~60), `langy` ports and gates (~150), `project` ports and
   checks (~150), `model-provider` checks. They were unreachable once the mount
   went, and leaving unused module-private functions fails lint. They are in git
   history. **The converted transports will need different port shapes anyway**
   (`defineTrpcRouter` does not take the same record), so re-deriving beats
   restoring.
4. **`ApiRestSecurity.create` now returns `AppRestSecurityPorts` rather than a
   built service.** The builder that wrapped it is gone. This is honest about
   what exists but it is a **half-truth in the type system**: the REST families
   are typed against a service object that no longer has `createProjectVersionedApp`.
5. **Three features lost their only door**: `home.*`, `integrationsChecks.*` and
   the back-office `bugReports.*` were tRPC-only, so their compositions are no
   longer wired into `api-production` at all. `integrations-checks.composition.ts`
   was trimmed to its two evidence ports (the scenario feature still fills one).

## The FINAL SHAPE this should reach

```
  module/server/src/
    transport/api-trpc/<name>.api.ts     defineTrpcRouter(...) — declaration only
    transport/api-rest/<name>.api.ts     defineRestRouter(...) — declaration only
    <module>.server.ts                   defineFeature(...).withApp().withTransports()
    index.ts                             exports the SERVER, not the transports

  apps/api/src/
    api.entrypoint.ts -> install(featureServers)     <- ONE install, no composition
```

The install model already exists in the tree — `modules/coding-agent/server/src/coding-agent.server.ts`
is written in it — and it is blocked only on `@langwatch/api` publishing
`createRestRouter` and `createTrpcRouter`. **That is the target, and
`api-production.composition.ts` is not on the way to it.**

## What needs binning, and what needs changing

| Thing | Verdict |
| --- | --- |
| `apps/api/src/app/api-production.composition.ts` (~4200 lines) | **BIN.** It is the compose-era spine: 40+ `composedX` fields, a hand-rolled feature graph, and a 120-line literal that used to build the tRPC record. Every feature already declares its own server. This file should become `install(...)` over a list of feature servers. Nothing I did here moves it toward that — I only cut dead edges out of it. |
| `apps/api/src/app-trpc/app-trpc.features.ts` | **BIN, after** it has served as the conversion checklist. The install model has no central namespace record. |
| `apps/api/src/features/*/*-trpc.mount.ts` (21) | **BIN as they convert.** Each exists only because the process, not the feature, built the router. Under `defineTrpcRouter` the feature owns the declaration and there is no process-side mount file. |
| `apps/api/src/features/*/*.composition.ts` + `.composition.types.ts` (~40 pairs) | **BIN.** The `.types.ts` split exists so importing a router type does not drag adapters in — a problem the install model does not have. |
| `apps/api/src/api-rest.security.ts` | **REFACTOR.** The enforcement (7 middlewares) is good and should stay. The `create` / `projectPolicy` split, the `Envelope`/`"throw"` mode and the legacy body renderer are all legacy-builder artefacts. It should fill one port record for `createRestRuntime` and nothing else. |
| `enterprise/packages/composition/api/src/trpc/*` (3 compositions) | **BIN.** They assemble feature transports on behalf of the process. Enterprise features should declare their own servers like every other module. |
| `packages/api` — `createRestRouter`, `createTrpcRouter` | **ADD.** Everything above is blocked on these two. They are the highest-value thing in the repo right now. |
| `security.createProjectVersionedApp` calls in ~30 REST transports | **CHANGE.** They load but cannot build. Each family converting to `defineRestRouter` removes one. |

## Where I stopped

Two edges remain, both owned by other lanes, both untracked files, and neither is
about the legacy transports:

- `apps/api/src/features/monitor/monitor.composition.ts:13` —
  `@langwatch/evaluator-server` does not export `EvaluatorReplicationApi`.
  (Blocks `apps/api` and `apps/api/src/api.entrypoint.ts`.)
- `apps/worker/src/app/worker-evaluation-app.composition.ts:20` (untracked) —
  `@langwatch/dataset-server` does not export `PostgresDatasetAdapter`.
  (Blocks `apps/worker`.)

Both are a renamed or not-yet-exported symbol in a module the feature-conversion
lanes are mid-way through. One export line each.
