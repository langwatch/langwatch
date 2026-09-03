# Flattening the tRPC collaborator groups (option D)

**Written:** 2026-09-03. **Audited:** 2026-09-04 against the working tree.
**Status:** steps A, B, C and D landed. D was typechecked once by the root
session, its five failures fixed here, and wants one more `apps/api` +
`apps/ui` typecheck to confirm. E is planned below and ready for package lanes.

Ruling from Alex: "the groups of apis is weird, no? why not just register each
one independently?" — approved. Every feature registers its tRPC router
independently, and `AppRouter` carries every namespace's procedures
(precondition for the api-maps retirement, option E in
`composition-simplification-options.md`).

## Landed

- **Step A — the mounting layer.** `3edf367d5a` (gateway, product-infra) and
  `0acdb3f67c` (org, agent, trace) deleted all five
  `apps/api/src/app-trpc/app-trpc.*-group.ts` files. `app-trpc/` now holds
  only `app-trpc.{collaborators,context,declared-check,error-formatter,features,policy,policy-kit,sse,types}.ts`
  and `index.ts`. The pinned sorted key list at
  `app-trpc.features.unit.test.ts` did not change in any step.
- **Step B — the composition layer.** The same two commits deleted the ten
  `withApi*Collaborators` folds, `sealApiTrpcCollaborators`,
  `REQUIRED_COLLABORATORS`, `REQUIRED_APPLICATION_SLICES` and
  `AnyApiTrpcCollaborators`, replacing them with one
  `composeApiTrpcCollaborators(halves, gapLogger)` call
  (`api-production.composition.ts:923`). `ApiTrpcCollaboratorGapReport` and
  `LoggedApiCollaboratorGap` were kept deliberately — they are the gap logger
  the one `if` writes through, not the runtime seal.
- **The `user.*` mount fix** that rode with step A:
  `createEnterpriseGovernanceTrpcRouters` returns `personalDashboard` and
  `user:` merges it, so `user.personalUsage`, `user.budgetOverview` and
  `user.cliBootstrap` answer. They did not before, and the /me screen calls
  them.

## The per-feature entry shape (current, keep)

There is no new abstraction — this is the shape `app-trpc.features.ts` uses
for every entry:

```ts
someNamespace: createSomeFeatureTrpcRouter({ ...mount, ports: ports.someFeature }),
```

or, for a feature whose one builder call returns several wire names:

```ts
const someFeature = createSomeFeatureTrpcRouters({ ...mount, ports: ports.someFeature });
// …
nameOne: someFeature.nameOne,
nameTwo: someFeature.nameTwo,
```

A plain object literal, not a `{ name, mount }` registry with a runtime loop —
the return statement already _is_ the registry. Where one wire name has two
owners (`governance`, `user`), the merge is a `mount.root.mergeRouters` in the
return literal, so nothing outside the list can add a third door onto the same
name.

## Landed — step C: `agents` and `secrets` are not optional

`apps/api/src/api.application.ts`: `ApiApplication.create` now takes
`agents: AgentService` and `secrets: SecretService` required (`agentTesting`
and `features` stay optional — `features` is still step D's decision, see
below). `MissingAgentService` and `MissingSecretService` are exported rather
than private, so every caller that composes neither passes the null object by
name instead of `ApiApplication` defaulting to one internally;
`unavailableAgents`, `unavailableSecrets` and `requireServices()` are deleted,
and the router literal (`this.trpc = this.root.router({ agents, secrets,
...this.buildFeatureRouters() })`) lost its conditional spreads — `agents.*`
and `secrets.*` mount unconditionally now, backed by the null object when a
process composed neither.

`apps/api/src/api.process.ts` needed one more change the design's audit missed:
it forwards its OWN optional `agents?`/`secrets?` straight into
`ApiApplication.create`, so with those now required it defaults
`options.agents ?? new MissingAgentService()` (same for secrets) at the
forwarding line rather than changing its own public options, which stay
optional as before. `app-trpc.types.ts` shrank to
`export type AppRouter = ApiApplication["trpc"];`, `PinPresent`/`RawAppRouter`
are gone.

**Behavior change, deliberate:** a process that composes no agent (or secret)
service used to mount NO router for that namespace at all. It now mounts the
namespace backed by the null object, and every call refuses by name
("Agent/Secret service is not configured for this API application.") instead
of the route not existing. Updated to match: the boot log line in
`LoggedApiAgentsAbsence.absent()` (`api-production.composition.ts`), the
`@unit Scenario: "A process with no database composes no agent service"` in
`specs/server/api-process-agents.feature` (its `Then`/`And` lines rewritten,
title kept identical since three test files bind to it by title), and
`apps/api/src/__tests__/api.application.agent-trpc.integration.test.ts`'s
matching test, which now asserts the router mounts and the call rejects by
name. The two composition-layer tests bound to the same scenario title
(`api-agents.composition.unit.test.ts`, `api-production.composition.unit.test.ts`)
were untouched in behavior — they test whether a real service gets COMPOSED
(`resolveAgents`/`ApiAgentsComposition.tryCompose`, still `undefined` with no
database), which step C does not change; only one IT description there was
reworded for accuracy.

Every `ApiApplication.create(` call site (20 across the repo, confirmed by
grep) now supplies both `agents` and `secrets`, real or the null object.

Verification: `grep -n "PinPresent\|RawAppRouter" apps/api/src/app-trpc/app-trpc.types.ts`
prints nothing (confirmed). `pnpm --filter @langwatch/platform-api test:unit
src/app-trpc src/app` — 49 files / 528 tests passed.
`pnpm --filter @langwatch/platform-api test:unit src/__tests__
src/features/discovery` — 22 files / 288 tests passed (one pre-existing
failure unrelated to this lane, fixed by the connected-agents-restore agent
working the same worktree concurrently — see its own commits for
`TestAgentService.ownersOf`).

## Landed — step D: the record's real type reaches `AppRouter`

`api-trpc-features.composition.ts` no longer casts. `build` declares
`AppTrpcFeatureRecord` and returns `createAppTrpcFeatures({ mount, ports })`
unchanged; `grep -n "as unknown as" apps/api/src/app/api-trpc-features.composition.ts`
prints nothing.

**The alias, inferred rather than restated.** `createAppTrpcFeatures` lost its
three MOUNT type parameters — `TContext` (constrained to a 70-line intersection
of every feature's context), `TOptions` and `TRoot` — and takes
`mount: ApiTrpcFeatureMount` directly. `app-trpc.features.ts` then exports

```ts
export type AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures>;
```

The parameters had to go. Read off a signature that is generic in its root,
`ReturnType` erases every parameter to its constraint — `TRoot` lands on
`AnyTRPCRootTypes`, and the production record is then NOT assignable to the
alias, because `RootConfig.errorFormatter` is a function property whose `ctx` is
contravariant under `strictFunctionTypes`. A first attempt tried to pin only the
mount with a conditional-inference read
(`typeof createAppTrpcFeatures extends (options: { mount: ApiTrpcFeatureMount }) => infer R`);
TypeScript did not instantiate the signature in that context, the alias
degenerated, and the typecheck reported it as 86 assignability errors at the
composition's `build`, a router the fetch adapter refused, and tRPC's
"property Provider collides" in the browser. Naming the concrete mount in the
SIGNATURE is what actually pins it: the root carries the context, so naming the
root names the context once. What remains generic is the ~28 PORT parameters,
which erase to their constraints — the one part a client reads back as
`unknown`.

`ApiTrpcContext` (`app-trpc.context.ts`) was already that same intersection
written down once, so nothing is lost: the constraint was a second copy of it.
Removing it made 74 context imports dead in `app-trpc.features.ts` (1078 -> 931
lines) and let `app-trpc.features.unit.test.ts` drop its own 70-line
`TestContext` and its `initTRPC` root — it now builds the mount on the exported
`createTrpcRoot()`, which is the application's own root and therefore the thing
the record is actually typed against. The pinned key list and every
`procedureNamesOf` list in that suite are unchanged, which is the evidence the
mount swap changed nothing that is mounted.

Two dead type imports were repaired in the same pass, since they broke
`ApiTrpcCollaborators` and cascaded into the same errors:
`LangyTrpcGates` is not exported by `@langwatch/langy-server` and lives in
`../features/langy/langy-trpc.mount` (which is where `app-trpc.features.ts`
already read it from), and `SharedTraceTrpcPorts` moved from
`@langwatch/share-server` to `@langwatch/trace-server`. Both are imported from
the surviving location; nothing is re-exported.

**The port and the application are generic over the record, and `features` is
REQUIRED** (Alex's ruling, 2026-09-03 — review option (i)).
`ApiTrpcFeaturesPort<TRecord extends TRPCRouterRecord = AppTrpcFeatureRecord>`
declares `build(mount): TRecord`; `ApiApplication<TRecord ... = AppTrpcFeatureRecord>`
threads it from `create`'s required `features` argument, and
`buildFeatureRouters(): TRecord` has no empty branch left. That is what makes
`trpc` a single router type rather than a union of "record mounted" and "no
record", and therefore what lets `app-trpc.types.ts` stay
`export type AppRouter = ApiApplication["trpc"];` — read unparameterized, so it
resolves the CLASS's default, which is the real record.

**The null object, honest and cast-free.** `api.application.ts` exports
`NoApiTrpcFeatures extends ApiTrpcFeaturesPort<Record<string, never>>`. Its
`build()` returns `{}` — genuinely empty, no cast, no `Partial`. Because the
record is empty no packaged procedure is built, so the four policy refusals it
supplies (`authorization`, `denials`, `causes`, `errorReporting`) are
unreachable and throw by name, and `application` reuses the
`unavailableFeatureApplication` proxy that already existed for this exact case —
not a written-out 40-slice double. Same bargain as `MissingAgentService` and
`MissingSecretService` one level up, which is why step C exported those.

`api.process.ts` keeps its OWN `features?` optional and forwards
`options.features ?? new NoApiTrpcFeatures()` at the call, exactly as step C did
for agents and secrets. All 19 test call sites now name the null object; the
import is sorted into each file's existing `api.application` import.

**The constraint is `TRPCCreateRouterOptions`, not `TRPCRouterRecord`.** The
record's values are BUILT routers, and `TRPCRouterRecord` (tRPC's
`RouterRecord`) only admits procedures and nested records — it is the DECORATED
shape a router carries after `router()` has run, not the shape `router()`
accepts. What `router()` takes is `CreateRouterOptions`, exported publicly as
`TRPCCreateRouterOptions`, whose values include `AnyRouter`. So
`ApiTrpcFeaturesPort<TRecord extends TRPCCreateRouterOptions>` and
`ApiApplication<TRecord extends TRPCCreateRouterOptions>`; with the wrong
constraint the record failed `TS2344` at both declarations and the fetch
adapter refused `this.trpc` downstream of it.

**Two defects the cascade had been hiding**, both in
`api-trpc-features.composition.ts`:

- `halves as Required<ApiTrpcCollaboratorHalves>` narrowed nothing.
  `Required<>` strips the `?` these members do not have and leaves the
  `| undefined` they do, so every `half.field` in the returned literal was
  "possibly undefined". Replaced with a mapped
  `ComposedApiTrpcCollaboratorHalves` that applies `NonNullable` — the runtime
  check above it already returns `undefined` for the whole record when any half
  is missing.
- `projects: productGroup.projectReads` was dead code (`TS2783`):
  `...orgGroup.application` further down the same literal carries `projects` and
  overwrote it silently. The org group's reader is the one that has been
  serving, so the overwritten line is deleted rather than the spread, and a
  comment says which half owns the slot.

**The request lane takes the adapter's own bound, not this record.**
`createHono` names `const router: AnyTRPCRouter = this.trpc` and hands the
handler that. It has to: `fetchRequestHandler`'s options are
`CreateContextCallback<inferRouterContext<TRouter>, ...>`, which is
`PartialIf<object extends TContext ? true : false, ...>` — a conditional on the
router's context. Read off `this.trpc`, whose record is generic here, the
context is `(Router<Root, D> & D)["_def"]…` with `D` a mapped type over a type
parameter, so it never resolves and the whole options object defers. Naming the
bound resolves it, and costs nothing real: the request lane routes by procedure
PATH and answers JSON either way. `AppRouter` is unaffected — it is read off the
class's default instantiation, which is concrete.

**The execution half declares what it composes, not `Partial` of what it
could.** Three members were `Partial<>` over a whole port type —
`experimentPorts`, `workflowPorts.lifecycle` and `workflowPorts.optimization` —
which made every capability `undefined` while the collaborators record requires
them, so the assignment failed one member at a time (`workbenchStateSchema`,
then `slugify`, and `prepareDsl` and `runPublishedWorkflow` waiting behind
them). Each is now a `Pick` of exactly the set the half composes
UNCONDITIONALLY, which is exactly the set the record asks for:

| Half member | Guaranteed set |
| --- | --- |
| `experimentPorts` | `coerceMonitorMappings`, `copyWorkflowWithDatasets`, `saveWorkflowVersion`, `slugify`, `upsertExperimentMonitor`, `workbenchStateSchema` |
| `workflowPorts.lifecycle` | `captureException`, `generateCommitMessage`, `prepareDsl`, `saveWorkflowVersion`, `workflowCreated` |
| `workflowPorts.optimization` | `runPublishedWorkflow` |

The complement in each case is `ApiOwnedExperimentPorts` /
`ApiOwnedWorkflowPorts` / `ApiOwnedOptimizationPorts` — the row reads, AuthZ
probes and one flag write the PROCESS answers, which
`app-trpc.collaborators.ts` already omits from what it asks of a half. So the
two sets line up by construction rather than by coincidence, and on `main`
`workbenchStateSchema` is a module constant
(`platform/app/src/server/experiments/workbenchState.ts`) — never absent, which
is why the collaborators type keeps requiring it.

**Proved by** `apps/api/src/app-trpc/__tests__/app-router.unit.test.ts`:
`inferProcedureInput` / `inferProcedureOutput` assertions over `agents.getAll`,
`secrets.getAll`, `user.getAccountInfo`, `user.hasPassword`,
`user.personalUsage`, `user.budgetOverview`, `bugReports.getAll`,
`bugReports.getById`, `dataPrivacy.getSnapshot`, `dataPrivacy.setForScope`,
`apiKey.create`, `apiKey.list`, `analytics.getTimeseries`,
`analytics.lwql.query`, `export.onExportProgress` and
`presence.onPresenceUpdate`, each `.not.toBeAny()`. No separate drift pin: with
`AppRouter` read straight off the class, an assertion that the two agree is a
tautology — the procedure assertions ARE the pin.

**And by one real inferred use in the browser.**
`apps/ui/src/behavior/ui-feature-transport.ts` gained `createUiAppApiClient`,
which builds `createTRPCClient<AppRouter>` over the SAME three lanes the
untyped client uses (extracted into `uiFeatureApiLinks`, so the typed client
cannot take a different lane). `AppRouter` arrives through
`@langwatch/platform-api/app-trpc/types`, `import type` only — no value crosses
into the browser bundle, so `frontend-boundary.unit.test.ts`'s value-import walk
never sees it. `@langwatch/platform-api` was added to `apps/ui`'s
devDependencies for the resolution; that closes no new cycle, since
`packages/platform-api-client` already depends on `@langwatch/platform-api`, and
`@langwatch/ui` was DROPPED from `apps/api`'s dependencies in this same step —
nothing in `apps/api/src` imported it, and while it stood the graph ran
apps/api -> apps/ui -> platform-api-client -> apps/api.

**Verification.** The type assertions are compile-time: neither `apps/api`'s nor
`apps/ui`'s vitest config enables `typecheck`, so `vitest run` executes
`expectTypeOf` as a no-op, and this lane was forbidden to run a typecheck. The
root session typechecked `apps/api` after the first attempt and returned the
five failures the paragraphs above describe; they are fixed and want a second
typecheck of `apps/api` and `apps/ui` to confirm. What DID run, green:

- `pnpm --filter @langwatch/platform-api test:unit src/app-trpc src/app src/__tests__` —
  66 files / 762 tests passed. Note this proves nothing about the TYPES: vitest
  transpiles rather than checks, which is why two rounds of root typechecks were
  needed to find what the suites could not see.
- `pnpm --filter @langwatch/ui test:unit run tests/ui-feature-transport-subscriptions.unit.test.ts tests/ui-app-api-client.unit.test.ts`
  — 3 files / 18 tests passed. The new `ui-app-api-client.unit.test.ts` drives a
  real `createUiAppApiClient` over a fake fetch and asserts the request is
  addressed to `/api/trpc/user.hasPassword`.
- `pnpm -s lint` — nothing on any file this step touched.

## Open: step E — retiring the 39 api maps

The reference implementation already exists and is not hypothetical:
`packages/platform-api-client/src/app-router-client.ts` exports
`trpcReact = createTRPCReact<AppRouter>()`, and
`packages/features/secret/web/src/behavior/secret-api.ts` is the one package
already off its map (`export const secretApi = trpcReact;`, whole client, not
`trpcReact.secrets` — `useUtils()` exists only on the top-level client). Step D
is what makes that client carry real procedure types instead of an erased
record, so every package below can now follow the same three-line shape.

**What replaces each site.** For a package whose binding is
`export const xApi = createFeatureApi<XApiMap>();`:

1. delete the hand-written `XApiMap` type and the `createFeatureApi` import;
2. `import { trpcReact } from "@langwatch/platform-api-client";` and
   `export const xApi = trpcReact;` — the existing name, so no call site moves;
3. delete the package's `*ApiMap` export from its `index.ts` and drop the map's
   now-unused contract imports.

Call sites do not change: `xApi.<namespace>.<procedure>.useQuery(...)` reads the
same, because the namespace is still the wire name the real router mounts it
under and tRPC hashes that same path into the React Query key. What DOES change
is that a wrong procedure name, a wrong input or a wrong answer shape is now a
compile error instead of a hand-written map agreeing with itself.

**The order — fewest procedures first**, so the first lanes are cheap to review
and the shape is settled before the big ones. Procedure counts are `output:`
entries in each map file.

| #   | Package                   | Map file                                             | Procedures |
| --- | ------------------------- | ---------------------------------------------------- | ---------: |
| 1   | github/web                | `behavior/github-api.ts`                             |          2 |
| 2   | notification/web          | `behavior/notification-api.ts`                       |          2 |
| 3   | enterprise/scim/web       | `behavior/scim-api.ts`                               |          3 |
| 4   | agent/web                 | `behavior/agent-api.ts`                              |          3 |
| 5   | data-privacy/web          | `behavior/data-privacy-api.ts`                       |          3 |
| 6   | topic/web                 | `behavior/topic-api.ts`                              |          3 |
| 7   | enterprise/licensing/web  | `behavior/licensing-api.ts`                          |          4 |
| 8   | project/web               | `behavior/project-api.ts`                            |          4 |
| 9   | coding-agent/web          | `coding-agent-api.ts`                                |          5 |
| 10  | annotation/web            | `screens/annotation-scores/annotation-scores-api.ts` |          6 |
| 11  | authz/web                 | `behavior/authz-api.ts`                              |          6 |
| 12  | monitor/web               | `behavior/monitor-api.ts`                            |          7 |
| 13  | project/web               | `behavior/home-api.ts`                               |          7 |
| 14  | onboarding/web            | `behavior/onboarding-api.ts`                         |          8 |
| 15  | auth/web                  | `behavior/auth-api.ts`                               |          9 |
| 16  | data-retention/web        | `behavior/data-retention-api.ts`                     |          9 |
| 17  | langy/web                 | `behavior/langy-api.ts`                              |         10 |
| 18  | api-key/web               | `behavior/api-key-api.ts`                            |         11 |
| 19  | evaluator/web             | `behavior/evaluator-api.ts`                          |         11 |
| 20  | enterprise/billing/web    | `behavior/billing-api.ts`                            |         13 |
| 21  | scenario/web              | `behavior/scenario-api.ts`                           |         13 |
| 22  | navigation/web            | `behavior/navigation-api.ts`                         |         14 |
| 23  | dataset/web               | `behavior/dataset-api.ts`                            |         15 |
| 24  | annotation/web            | `behavior/annotation-api.ts`                         |         25 |
| 25  | model-provider/web        | `behavior/model-provider-api.ts`                     |         25 |
| 26  | automation/web            | `behavior/automation-api.ts`                         |         27 |
| 27  | prompt/web                | `behavior/prompt-api.ts`                             |         29 |
| 28  | analytics/web             | `behavior/analytics-api.ts`                          |         31 |
| 29  | user/web                  | `behavior/personal-workspace-api.ts`                 |         36 |
| 30  | workflow/web              | `behavior/workflow-api.ts`                           |         45 |
| 31  | organization/web          | `behavior/organization-api.ts`                       |         50 |
| 32  | enterprise/governance/web | `behavior/governance-api.ts`                         |         51 |
| 33  | gateway/web               | `behavior/gateway-api.ts`                            |         54 |
| 34  | ops/web                   | `behavior/ops-api.ts`                                |         98 |
| 35  | trace/web                 | `ui/sections/trace-api.ts`                           |         99 |

Two packages carry a second binding in the same package (`project/web` at #8 and
#13, `annotation/web` at #10 and #24) — do them as one lane each, not two, since
both bindings collapse onto the same `trpcReact`.

**The `useInvalidateProcedure` / `trpcQueryKey` moves.** Both exist for exactly
one reason, stated in their own docblocks: a hook has to invalidate a procedure
its feature's map does not declare, so it names the path as a STRING and a typo
is a silent no-op. Once a package is on `trpcReact`, every procedure is
declared, and the string form is strictly worse than
`xApi.useUtils().<namespace>.<procedure>.invalidate()`. So each package's
migration lane finishes by rewriting its own string-path invalidations:

- `packages/features/trace/web` — 3 sites, rewritten in lane #35;
- `packages/features/analytics/web` — 1 site, rewritten in lane #28;
- `apps/ui` — 17 sites, rewritten LAST, after every lane above, because the
  shell invalidates across features and cannot be typed until they are all on
  the one client.

When the last of those lands, `useInvalidateProcedure`, `trpcQueryKey`,
`trpcQueryFilter` and `createFeatureApi` (with `FeatureApiMap`,
`FeatureApiClient`, `ProcedureShape`, `RouterFromMap`) are all dead and get
DELETED from `packages/platform-api-client`, along with
`packages/platform-api-client/tests/trpc-query-key.unit.test.ts` — not kept as a
compatibility surface. `apps/ui`'s `createUiFeatureApiClient` and
`UiFeatureApiTransport` go with them, leaving `createUiAppApiClient` as the one
transport; the shell mounts `trpcReact.Provider` with it once, rather than one
Provider per feature.

## What keeps working, and why

- **Declared-check sweep** (`app-trpc.declared-check.ts`): its unit is the
  procedure, not the entry in the return literal, so flattening is invisible
  to it.
- **Public-surface tripwire**: the pinned sorted key list plus
  `procedureNamesOf(features.X)` per namespace. The key list must not change
  in a mounting step; the procedure lists change only for a deliberate mount
  fix (the `user.*` merge above).
- **Langy permission suites** read `ApiApplication["trpc"]`'s procedures off
  the built router, the same way the sweep does.

## Known defect this lane left behind

Fixed during step B: `apps/api/src/index.ts` no longer re-exports
`withApiTraceGroupCollaborators` or `withApiGatewayGroupCollaborators`
(`grep -n` for either name in that file prints nothing).
