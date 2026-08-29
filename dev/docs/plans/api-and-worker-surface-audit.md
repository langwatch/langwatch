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

### Defects found, and fixed

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

One document is still out of step, and deliberately left alone: the working
tree's `docs/api-reference/openapiLangWatch.json` carries an uncommitted
regeneration from an earlier session and now disagrees with
`platform/app/src/app/api/openapiLangWatch.json` — 181 paths against 196, with
the unversioned management paths still in it. Nothing writes the `docs/` copy
automatically; `docs/scripts/generate-api-reference-pages.ts` only reads it.
Regenerating it is a one-line follow-up once the ADR 002 question is settled,
because the answer decides which of the two shapes is right.

The five `/api/secrets` operations reappeared in the document once the
generator could run. Their request bodies came back too: both were declared
with hono-openapi 0.4's `request` key, which 1.x ignores in favour of deriving
`requestBody` from the validator — and these two routes used `hiddenValidator`,
which strips exactly that metadata.

### Fourteen more, found by making the app typecheck

`apps/api` typechecked with 90 errors; ten were its own and the rest were in
the feature packages it pulls in. Working through them turned up defects rather
than noise, because a transport that cannot compile is a door nobody has run:

- **`license.*` and `licenseEnforcement.*` raised a TypeError on every call.**
  Both transports read their capabilities through `ctx.app.licensing`, eight
  call sites between them, and nothing in `platform/app` composed a
  `LicensingApp` or put one on the App. The composition still passed the ports
  the transports used to take — TypeScript objected at four call sites, and the
  values were then ignored at runtime, so the argument that was still there
  described a wiring that no longer existed.
- **`prisma.annotation-queue.repository.ts` could not load at all**, importing
  `AnnotationQueueStore` from a file that does not exist.
- **`GatewaySpendProcessingEvent`** was named by the spend pipeline, its
  settlement process manager and its fold projection, and declared by none of
  them — because `gateway-spend-events.adapter.ts` hand-wrote its own envelope
  instead of extending the framework's `EventSchema`, and the copy disagreed in
  three ways: no `createdAt`, `occurredAt` as a `Date` rather than epoch
  milliseconds, and plain strings where the framework brands `tenantId`,
  `aggregateType` and `type`.
- **A graph alert or a scheduled report could be created with an action it
  cannot perform.** Both deliver notifications and have nowhere to put a row;
  their builders' input types say so and the door passed `input.action` through
  from the full enum, so a graph alert asking to add to a dataset was stored
  and then never delivered. It is refused now, with its own error code and
  customer copy.
- **`budgetStatus` never fired its 80% warning for a blocking scope**: the
  guard was `"pctUsed" in topScope && topScope.pctUsed >= 80` over a union
  where only one member carries the field, which types the value `unknown`.
- **The webhook test-fire sliced an `unknown` body**, which throws on a queue
  transport that answers with anything but a string.
- Four chained `procedure.input(a).input(b)` calls — three trace reads and one
  analytics read — had not compiled since their first schema became a port.
  tRPC types the second call as a conditional on the input already
  accumulated, and a conditional over an unresolved type parameter never takes
  the merging branch.
- Three helpers annotated `ctx` with the router's type parameter rather than
  the constraint. tRPC hands a resolver a `Simplify<TContext>`; eleven call
  sites in the SSO back office alone.
- Two middlewares returned on some paths and fell off the end on others.
- `@langwatch/gateway-contract` was imported by
  `composition/api/src/governance/gateway-debit.adapter.ts` and was not a
  dependency of that package.

And a regression of this branch's own test colocation: six fixtures stayed in
`tests/` when their tests moved into `__tests__`, and two of the three tests
reading them broke. `automation-template.service.unit.test.ts` failed to load
entirely, taking twenty tests with it.

### What is left for this app

- 44 REST apps and 18 internal-api tRPC routers to extract.
- Make the standalone process serve the composed surface, or accept that
  `platform/app` remains the composition root until it is deleted.
- Resolve ADR 002's status against the shipped removal.
- **One decision, not a repair.**
  `packages/features/stored-object/server/src/api/public/stored-object.api.ts`
  is the only remaining source of typecheck errors reachable from this app
  (12 of them, plus 1 red test). It is written against
  `GroupRegistrar.register(name, version, …)`, which ADR 001's withdrawal
  removed — "no service ever registered a dotted operation, so every catalogue
  answered empty" — and this v0 family is the counter-example that was
  overlooked, because nothing installs it. It is not on `main`'s spec, and the
  feature already has a live REST family (`/api/files`) and a live tRPC
  transport. Port it onto `registerRoute`, which means choosing REST paths for
  its four operations, or delete it.

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
apps/api      20 test files, 83 tests, green
apps/worker   19 test files, 107 tests, green
both apps     zero typecheck errors, in src AND in tests
apps/api's dependency graph   90 errors -> 12, all twelve in the one file above
route gate    274/381 documented, 0 unexplained, 0 stale
```

`apps/api` ran 95 tests before its own `tests/` mirror was dissolved; twelve of
them tested `@langwatch/api` and moved there, which is why that package now
runs 302 rather than 290.
