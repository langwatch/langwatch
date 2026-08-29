# What `apps/api` and `apps/worker` serve today, and how that differs from `main`

Written while driving both apps toward completion on `feat/strict-feature-layout-v0`.
Every number below came from running something, not from reading; the command that
produced it is named beside it so it can be re-run.

## The short version

Nothing that `main` serves has been lost by accident. Twenty-three operations
that `main` serves are gone **on purpose**, and one document had drifted far
enough to hide five operations that were still being served.

Neither app is the process that runs in production yet. `apps/api` is composed
by `platform/app`; `apps/worker`'s production composition is composed by
nothing at all.

## `apps/api`

### What the standalone process serves

`src/api.entrypoint.ts` → `ApiRuntimeBootstrap` → `ApiProductionComposition`
gives you:

| Surface   | What is on it                                                            |
| --------- | ------------------------------------------------------------------------ |
| tRPC      | `agents.*`, `secrets.*` — nothing else                                   |
| REST      | `ApiSecretRestFeature` (`/api/v1/secret`), `ApiKeyManagementRestFeature` |
| lifecycle | readiness, metrics, drain                                                |

That is the whole standalone process. It is a real, bootable API and it is not
the product's API.

### What `apps/api` actually provides

The package is the **transport and registry library** the product's API is
built from, and `platform/app/src/server/api-router.ts` is the composition root
that serves it:

- `createAppRestFeatures` — one enumeration of **40 REST families**, mounted by
  `api-router.ts:244`, and read by the route-authorization audit and the Langy
  permission suites. A family cannot serve traffic while being invisible to the
  audit, which is the whole reason it is one list.
- **27 tRPC mounts** in `src/features/*/*-trpc.mount.ts`, called by
  `platform/app/src/server/api/routers/*` and `root.ts`.

Behaviour lives in the feature packages: **86 tRPC transports** and **37 REST
transports** under `packages/**/transport/api-{trpc,rest}/`.

```sh
find packages -path '*/transport/api-trpc/*.api.ts' -not -path '*__tests__*' | wc -l   # 86
find packages -path '*/transport/api-rest/*.api.ts' -not -path '*__tests__*' | wc -l   # 37
```

### What is still implemented inside `platform/app`

**44 REST apps** are mounted directly by `api-router.ts` rather than through a
package: `auth`, `collector`, `otel`, `rum`, `langy-*` (four of them),
`experiments-v3`, `analytics-sql`, `traces`, `github`, `scim`, `webhooks`,
`admin`, `ops`, `cron`, `sse`, `misc`, and the rest. **18 internal-api tRPC
routers** are still in `platform/app/src/runtime/app/internal-api/`.

Those are the remaining extraction work for this app. Everything else has an
owner.

### Differences from `main`

**tRPC: a strict superset.** 93 routers against `main`'s 88, with none dropped.
The five added are `frontDoor`, `identity`, `joinRequests`, `setupSkills` and
`ssoConnections`.

**REST: 23 operations removed, deliberately.** The unversioned management paths
answer 404 on this branch — they are not registered at all, not merely
undocumented:

```text
/api/organization      GET PATCH · invites GET POST · invites/{id} DELETE
                       members GET · members/{userId} GET PATCH DELETE
                       members/{userId}/access GET
/api/roles             GET POST · {id} GET PATCH DELETE · permissions GET
/api/role-bindings     GET POST · {id} PATCH DELETE
/api/scim-tokens       GET POST · {id} DELETE
```

A caller uses `/api/<family>/latest/…` or a dated namespace instead. The
decision is `packages/api/adrs/002-explicit-version-namespaces.md`: the bare
alias was the one URL the document pointed at and the one URL no client should
call, so it went. **That ADR is still `Proposed` while the code has shipped the
breaking change** — worth resolving before release, either by accepting it or
by restoring the aliases.

**76 operations are new** on the branch, mostly the dated and `latest`
namespaces those four families gained, plus `/api/agent-cache/*`,
`/api/experiments/{slug}/*` and `/api/scenarios/{id}/versions*`.

### Three defects found, and fixed

1. **No task ran, on any task.** `platform/app/src/env.mjs` held the installed
   configuration in a module-scoped binding. tsx compiles the application's
   `.ts` to CommonJS while `src/task.ts` reaches `env.mjs` through a dynamic
   `import()`, so there were two instances of that module and boot installed
   the environment in the one nothing read. Every task died on its first `env.`
   access with "Application environment is not initialized". Now keyed on a
   realm symbol, the way `@langwatch/handled-error` keys its runtime
   constructor. `main` is unaffected — its `env.mjs` evaluates at import.

2. **`@langwatch/platform-api/app-rest` could not be an entry module.** The
   barrel re-exported `./app-rest.features` before
   `export … from "@langwatch/api/rest"`, and the five families still living in
   `apps/api/src/features` imported the kit back from the barrel mid-evaluation.
   Entering there threw `Cannot read properties of undefined (reading
'apiErrorSchema')`. `api-router.ts` imports through that same specifier, so
   this was a live boot-order hazard. The five now import from `@langwatch/api`
   and `@langwatch/api/rest` directly, which is what the barrel's own docstring
   already prescribed.

3. **The route-coverage gate was auditing 146 of 381 routes.** `HANDLER_ROOTS`
   named three trees inside `platform/app`; the families had moved to
   `packages/features/*/server`, `packages/enterprise` and `apps/api`. Anything
   outside those three trees was neither published nor excused nor reported —
   and the ratchet then declared four `UNPUBLISHED` entries stale because it
   could no longer see the routes they excused. Two of them, `/api/admin` and
   `POST /api/export/traces/download`, had been deleted; both routes still
   exist. Restored, with `main`'s wording.

   ```text
   before   45/146 routes documented, 3 unexplained, 4 stale entries
   after   274/381 routes documented, 0 unexplained, 0 stale entries
   ```

   `pnpm --filter @langwatch/web check:openapi-route-coverage`

The five `/api/secrets` operations reappeared in the document once the
generator could run. Their request bodies came back too: both were declared
with hono-openapi 0.4's `request` key, which 1.x ignores in favour of deriving
`requestBody` from the validator — and these two routes used `hiddenValidator`,
which strips exactly that metadata.

### What is left for this app

- 44 REST apps and 18 internal-api tRPC routers to extract.
- Make the standalone process serve the composed surface, or accept that
  `platform/app` remains the composition root until it is deleted.
- Resolve ADR 002's status against the shipped removal.
- `packages/features/stored-object/server/src/api/public/stored-object.api.ts`
  is written against a `GroupRegistrar.register` that the builder no longer has
  (12 type errors, 1 red test). It is a v0 foundation: nothing installs it and
  it is not on `main`'s spec. Either port it to `registerRoute`/`RestService`
  or delete it.

## `apps/worker`

### What runs today

**Twenty-two pipelines, all of them through the legacy graph.**
`platform/app/src/workers.ts` boots `WorkerExecutable` with
`LegacyWorkerExecutableComposition`, which calls `initializeWorkerApp()` and
`WorkerRuntime.create(createLegacyWorkerPorts(app))`. The pipelines register in
`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`;
Trace and Topic register through their own installers in the app graph.

`WorkerProductionComposition` — the extracted graph, with its documented mount
order — **is referenced by nothing but its own tests**. That is the headline
for this app: every pipeline processes messages, and none of them does so
through the composition that was built for them.

### What was fixed

`src/features/catalogue.json` declares 24 features, and its test pins that list
against the installers on disk, so all 24 are real. `orderedFeatureInstallers`
named 19. The five it left out — `api-key`, `identity`, `sso-connection`,
`scim-sync`, `join-request` — were unreachable: no composition option, no
`createFromPorts` parameter, and no reference to their classes anywhere outside
their own files.

They are now composable and ordered where the live registry puts them: api-key
beside the other unconditional reapers, the four identity ledgers after AuthZ.
The registration-order suite composes all five and pins both the installer
order and the 24 pipeline names that reach Eventing.

Their docstrings each claimed nothing had ever mounted them — one said
"`PipelineRegistry` has never carried a reference … in any revision". True when
written; false one commit later, when `f9fd8aeab5` added 157 lines to
`pipelineRegistry.ts` registering all five. Corrected.

### What is left for this app

- Make `WorkerProductionComposition` the live composition. That means supplying
  every installer's dependencies from the app graph, and **deleting each moved
  pipeline's legacy registration in the same change** — two graphs registering
  one pipeline name in one process is a bug, not a migration step.
- `platform/app/src/server/workers/startWorkers.ts` still owns the ancillary
  boots: storage stats, the scenario processor pool, ops workers, the
  spend-spike detector, the realtime voice poller, the metrics server.

## Verification

```text
apps/api      22 test files, 95 tests, green; own sources typecheck clean
apps/worker   19 test files, 107 tests, green; own sources typecheck clean
route gate    274/381 documented, 0 unexplained, 0 stale
```

`apps/api`'s typecheck still reports 71 errors and `apps/worker`'s 5, all of
them inside feature packages they depend on rather than in either app: the zod
dual-major boundary in four tRPC transports, `stored-object`'s dead public RPC
family, and a Hono context variance in `stored-object`'s REST family.
