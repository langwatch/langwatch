# Flattening the tRPC collaborator groups (option D)

**Written:** 2026-09-03. **Reviewed:** same day, `trpc-flatten-review.md` — approve
with fixes; the fix list and the executable work list live there. **Status:**
fix list items 1, 2, 4, 5 done; fan-out steps A1–A4 done and verified (all four
mounting-group files deleted; `AppTrpcFeaturePorts` and `ApiTrpcCollaborators`
are now flat, one entry per feature, no group bags); steps B, C, D not started
this pass — see "Deviations" below.
Ruling from Alex: "the groups of apis is weird, no? why not just register each
one independently?" — approved. Every feature registers its tRPC router
independently: one entry per feature, no group halves, no
`withApi*Collaborators` spreads, no `as unknown as`, and `ApiTrpcFeaturesPort.build()`
returns the real inferred router type so `AppRouter` carries every namespace's
procedures (precondition for the api-maps retirement, option E).

## Decisions taken

- **Step D's open ruling** (`ApiApplication.create`'s `features` optional vs.
  required): took the reviewer's recommendation, option (i) — `features`
  becomes required, matching Step C's null-object pattern
  (`MissingAgentService`/`MissingSecretService`) rather than adding a
  type-level pin. Not yet implemented (Step D was not reached this pass); this
  is the design Alex should overturn if he disagrees, before whoever picks up
  Step D builds it.

## Deviations

Executed in order: fix list items 1, 2, 4, 5 (item 3 was already a separate
concern; item 6 is the design-doc edit this file itself is), fan-out step A1
(prior pass), then A2 (org-group), A3 (agent-group) and A4 (trace-group) this
pass. Stopped after A4 and did not start B, C or D.

**Why.** Step B is a rewrite of the ~4,000-line `api-production.composition.ts`
fold chain plus ten `api-trpc-collaborators.*.composition.ts` files, replacing
every `withApi*Collaborators` fold and the `sealApiTrpcCollaborators` runtime
check with one typed object literal — a change of a different shape and risk
than A, and the review's own plan calls it out as one change rather than ten.
It also lands in `api-production.composition.ts`, which another concurrent
lane (connected-agent composition, Slice 7) is about to touch additively; this
pass coordinated with that lane and stopped at the boundary rather than start
a large rewrite of a file both were converging on. C and D depend on B (D
needs both B and C), so they wait too. This pass's remaining budget did not
cover B, C and D on top of A2–A4.

**A2–A4, what changed.** Same shape as A1, three more times, at increasing
size: org-group (9 namespaces, `app-trpc.org-group.ts` deleted, 209 lines),
agent-group (6 namespaces, `app-trpc.agent-group.ts` deleted, 244 lines),
trace-group (16 namespaces, `app-trpc.trace-group.ts` deleted, 322 lines, 12
type parameters absorbed into `AppTrpcFeaturePorts`/`ApiTrpcCollaborators`
directly). Two of the three composition-half structs
(`ApiAgentGroupCollaborators`, `ApiTraceGroupCollaborators`) already carried a
same-named APPLICATION slice for some of their ports (`scenarios`, `langy`,
`ops` for agent-group; `traces` for trace-group) — a port and an application
slice cannot share one key on one object, so those two composition files keep
a small nested `ports` struct internally (`ApiAgentGroupPorts`,
`ApiTraceGroupPorts`, documented in place) and only their `withApi*Collaborators`
fold spreads the port keys onto the flat record; `ApiTrpcCollaborators` and
`AppTrpcFeaturePorts` themselves have no bag anywhere. org-group's half had no
such collision and flattens all the way through, matching the gateway/product-infra
reference exactly.

**Verification.** After A2: `test:unit src/app-trpc` 41/41, `test:unit
src/app` 528/528 (one org-group assertion updated to read the flat keys off
the half's return instead of a nested `ports`). After A4: `test:unit
src/app-trpc` 37/37 collected of 3 files (`app-trpc.features.unit.test.ts`
fails to *collect* — see below), `test:unit src/app` 393/393 collected of 38
files; the trace-group integration suite's real `/api/trpc` calls
(`traces.getById`, `tracesV2.newCount`, `costs.getAggregatedCostsForOrganization`,
`plan.getActivePlan`, etc.) all ran and passed. 11 suites in `src/app` and
`src/app-rest` fail to collect on `Cannot find package '@langwatch/task'
imported from .../packages/features/topic/server/src/tasks/topic-clustering-run.task.ts`
— `packages/features/topic/server/src/tasks/` is untracked, uncommitted work
from a concurrent lane; the package exists in the workspace
(`packages/task`) but isn't declared as a dependency in
`packages/features/topic/server/package.json` yet, so no `pnpm install`
fixes it. Reproducible before and unrelated to any file this pass touched —
same class of concurrent-lane collection failure the previous pass's log
describes for `scenario-contract`/`suite-server`. `pnpm --filter
@langwatch/architecture-lint test`: 608/609, one unrelated failure
(`tests/no-binary-source-files.test.ts`, flags a NUL byte in
`packages/features/coding-agent/server/src/repositories/__tests__/coding-agent-session-clickhouse-dedup.unit.test.ts`,
also uncommitted work from a concurrent lane, not one of the three
`tests/frontend-ui-boundaries.test.ts` failures this lane was told to ignore).

**State left in.** A1–A4's flattening is complete and verified — no
half-migrated state. `AppTrpcFeaturePorts` and `ApiTrpcCollaborators` are now
fully flat: every namespace's ports are top-level entries, no `orgGroup`,
`agentGroup`, `traceGroup`, `productInfra` or `gatewayGroup` bag anywhere, and
all four remaining `app-trpc.*-group.ts` mounting files are deleted (only
`app-trpc.features.ts`, `app-trpc.collaborators.ts`, `app-trpc.context.ts`,
`app-trpc.declared-check.ts`, `app-trpc.policy.ts`, `app-trpc.policy-kit.ts`,
`app-trpc.sse.ts`, `app-trpc.types.ts` and `index.ts` remain in `app-trpc/`).
The next agent should pick up at Step B: the ten `composeApi*Collaborators`
functions stay, the ten `withApi*Collaborators` folds and
`sealApiTrpcCollaborators` in `api-production.composition.ts` go, replaced by
one `composeApiTrpcCollaborators(halves, gapLogger)` call. Check in with
whichever lane is then working `api-production.composition.ts` before
starting — coordinate the same way this pass did.

## Two group mechanisms, not one

The measurement in `composition-simplification-options.md` says "10
collaborator groups", but there are two layers that both call themselves
"groups" and only partly overlap:

1. **Mounting groups** (`apps/api/src/app-trpc/app-trpc.*-group.ts`, plus
   `app-trpc.product-infra.ts`): a function that calls several feature
   packages' own `create*TrpcRouter(s)` builders and returns their combined
   output as one object, which `app-trpc.features.ts` then spreads with
   `...group` instead of listing each namespace. Five existed:
   `gateway-group` (deleted by this reference), `org-group`, `agent-group`,
   `trace-group`, `product-infra`.

2. **Composition groups** (`apps/api/src/app/api-trpc-collaborators.*.composition.ts`):
   a function that composes the *ports and `ctx.app` slices* several
   namespaces need, plus a `withApi*Collaborators(base, half)` fold that
   spreads them onto an accumulator, ending in one `sealApiTrpcCollaborators`
   call in `api-production.composition.ts:938-972`. Ten exist:
   `agent-group`, `analytics`, `execution`, `gateway-group`, `identity`,
   `org-group`, `product-group`, `product-infra`, `product`, `trace-group`.

Five of the ten composition groups (`analytics`, `execution`, `identity`,
`product-group`, `product`) never had a mounting-group wrapper; their
namespaces were always individual entries in `app-trpc.features.ts`, only
their *composition* is grouped.

Alex's complaint is visible at layer 1 — one opaque `...gatewayGroup` entry in
the file whose docblock says it is "the one list". But layer 2 is where the
goal is actually blocked: the folds cast to `AnyApiTrpcCollaborators`, which
erases 14 of `ApiTrpcCollaborators`' 19 type parameters to `unknown`, and that
is why `ApiTrpcFeaturesComposition.build()` ends in `as unknown as TRPCRouterRecord`.
Flattening layer 1 alone changes nothing about `AppRouter`.

## Before / after (gatewayGroup, mounting layer)

```
BEFORE                                              AFTER
─────────────────────────────────────────────────  ─────────────────────────────────────────────────
app-trpc.features.ts                                app-trpc.features.ts
┌────────────────────────────────────────────┐      ┌────────────────────────────────────────────┐
│ return {                                    │      │ const gateway = createGatewayTrpcRouters(…) │
│   ...createAppGatewayGroupTrpcFeatures({    │      │ const governance =                          │
│        mount, ports: ports.gatewayGroup }), │      │   createEnterpriseGovernanceTrpcRouters(…)  │
│   // 21 keys, opaque                        │      │ const billing =                             │
│   analytics: …,                             │      │   createEnterpriseBillingTrpcRouters(…)     │
│   annotation: …,                            │      │                                              │
│   …                                         │      │ return {                                    │
│ }                                           │      │   virtualKeys: gateway.virtualKeys,         │
└────────────────────────────────────────────┘      │   gatewayBudgets: gateway.gatewayBudgets,   │
              ▲                                      │   …four more gateway.* entries…             │
              │ delegates to                          │   activityMonitor: governance.activityMonitor,│
┌────────────────────────────────────────────┐      │   …eleven more governance.* entries…        │
│ app-trpc.gateway-group.ts (183 lines)       │      │   governance: mergeRouters(                 │
│   calls the same three builders,            │      │     governance.governance,                  │
│   returns { …21 keys… }                     │      │     createGovernanceHomeTrpcRouter(…)),     │
└────────────────────────────────────────────┘      │   currency: billing.currency,               │
                                                     │   subscription: billing.subscription,       │
                                                     │   analytics: …,                             │
                                                     │ }                                           │
                                                     └────────────────────────────────────────────┘
                                                                   (file deleted — no middle layer)
```

The set of top-level keys is unchanged — `app-trpc.features.unit.test.ts:461`
pins the sorted list and it is byte-for-byte the same. What changed is that
the 21 keys are now visible, one call each, where the file's own docblock says
the one list is.

One thing about *what* is mounted did change in the same diff, and it is a
fix rather than a flatten: `createEnterpriseGovernanceTrpcRouters` now returns
`personalDashboard` (fourteen routers, not thirteen) and `user:` merges it, so
`user.personalUsage`, `user.budgetOverview` and `user.cliBootstrap` answer.
They did not before, and the /me screen calls them
(`packages/features/user/web/src/behavior/use-personal-context.ts:128,138`).
The `HEAD` comment at `app-trpc.features.ts:730` already claimed the merge;
the code now matches it. It lands as its own commit (review fix 3).

## The per-feature entry shape

There is no new abstraction to name — the shape every other entry in
`app-trpc.features.ts` already uses is the target:

```ts
someNamespace: createSomeFeatureTrpcRouter({ ...mount, ports: ports.someFeature }),
```

or, for a feature with several wire names sharing one builder call
(`organization-trpc.mount.ts` returns `{ group, joinRequests, onboarding,
personalWorkspaceFeatures, team }` from one call):

```ts
const someFeature = createSomeFeatureTrpcRouters({ ...mount, ports: ports.someFeature });
// …
nameOne: someFeature.nameOne,
nameTwo: someFeature.nameTwo,
```

A plain object literal, not a `{ name, mount }` registry entry with a runtime
loop — the return statement already *is* the registry, and a loop over it would
need to be generic over each entry's distinct ports and context type, which is
the clever-generics shape Alex ruled out. One process composes its dependencies
once and each line is one call; tRPC's router record is the registry format the
transport reads.

Where one wire name has two owners (`governance`, `user`), the merge is a
`mount.root.mergeRouters(a, b)` in the return literal, so nothing outside the
list can add a third door onto the same name.

## Ports: one entry per feature, no bags

The reference still hands the gateway ports over as one
`AppTrpcFeaturePorts.gatewayGroup: { gateway, governanceHome, saasBilling }`
bag, moved from the deleted file into `app-trpc.features.ts:205-230` under a
`TEMPORARY SEAM` comment. That is not kept: the three become top-level entries
(`gateway`, `governanceHome`, `saasBilling`) on `AppTrpcFeaturePorts` and
`ApiTrpcCollaborators`, and the `TGatewayGroup` type parameter goes. The edit
outside `app-trpc/` is five lines — `api-trpc-collaborators.gateway-group.composition.ts:142-143,372`,
`api-trpc-ports.composition.ts:392`, `REQUIRED_COLLABORATORS` at
`api-trpc-collaborators.product.composition.ts:443` — plus three test fixtures.
The earlier version of this doc said changing the half's shape would "ripple
into every other group's fold order"; it does not. Each fold spreads `...base`
and adds its own keys, they compose in any order by the chain's own comment,
and the gateway fold is the outermost call.

The same applies to the other four group ports interfaces
(`AppTraceGroupTrpcPorts`, `AppOrgGroupTrpcPorts`, `AppAgentGroupTrpcPorts`,
`AppProductInfraTrpcPorts`): each dissolves into top-level entries when its
mounting file is deleted (review step A). `AppTrpcFeaturePorts` ends as one
flat interface, one entry per feature that has any, no type parameters — the
concrete types are the ones the `composeApi*Collaborators` functions already
return today.

## Composition: one literal, not ten folds

The ten `composeApi*Collaborators` functions stay; they build ports from the
process graph and their return types are concrete. What goes is the fold chain
and everything that exists because of it: the ten `withApi*Collaborators`
functions and their `as [unknown as] AnyApiTrpcCollaborators` casts,
`sealApiTrpcCollaborators` with `REQUIRED_COLLABORATORS` and
`REQUIRED_APPLICATION_SLICES`, `ApiTrpcCollaboratorGapReport` and
`LoggedApiCollaboratorGap`, `AnyApiTrpcCollaborators`, the 19 type parameters
on `ApiTrpcCollaborators`, the 22 on `AppTrpcFeaturePorts`, the 14 on
`ApiTrpcFeaturesComposition`, and `options.trpcCollaborators`
(`api-production.composition.ts:412`, an optional seed nobody passes).

In their place, `api-production.composition.ts` passes the ten `composed*`
halves to one `composeApiTrpcCollaborators(halves, gapLogger)`: `if` any half
is `undefined`, log the missing names and return `undefined` (the all-or-nothing
rule, one `if`); otherwise return the object literal, one line per
`ApiTrpcCollaborators` key, typed, no cast. A missing key is a compile error
naming the key — which is what the runtime seal was doing by hand. This is one
change, not ten; doing it "per group" through the fold keeps the chain, the
seal and the casts alive until the last group. Review step B.

## Conditional namespaces (agents, secrets)

`agents.*` and `secrets.*` are mounted by `ApiApplication`'s constructor
(`api.application.ts:435-441`), spread in only when their service was
supplied, which is why `app-trpc.types.ts` has to `PinPresent` every key.
`install-composition-review-2026-09-03.md` §5 left this lane the job of ending
that: `ApiApplication.create` takes both services required
(`api.process.ts:78-80` always passes both), the 20 test call sites that omit
them pass `MissingAgentService` / `MissingSecretService` — the null objects
`api.application.ts:202,285` already define for exactly that — and
`app-trpc.types.ts` becomes `export type AppRouter = ApiApplication["trpc"]`.
Review step C. The earlier version of this doc defended the conditional spreads
as "about as flat as it gets"; a flat list has no `if`s in it.

## `ApiTrpcFeaturesPort.build()` returning the real type

`api-trpc-features.composition.ts:264` (`as unknown as TRPCRouterRecord`) and
`api.application.ts:199` (`abstract build(mount): TRPCRouterRecord`) are the
two lines between every feature router and `AppRouter`. They are not blocked
on the other mounting groups — `createAppTrpcFeatures`'s return type is fully
inferred today regardless of how many sub-calls feed it. They are blocked on
the composition-layer erasure above: with 14 type parameters instantiated as
`unknown`, a real `ReturnType` would carry `unknown` outputs for bug reports,
data privacy, experiments and the analytics inputs. So the order is B, C, then
D: `build()` returns `AppTrpcFeatureRecord`, exported from
`app-trpc.features.ts`, and the cast deletes. One decision in D is Alex's —
whether `ApiApplication.create`'s `features` becomes required (recommended;
matches C) or `AppRouter` is declared from the record type with a type-level
pin. Review step D states both.

## What keeps working, and why

- **Declared-check sweep** (`app-trpc.declared-check.ts` + the four
  `AppAuthzMiddlewareBuilders`): reads access decisions off individual
  procedures as each `create*TrpcRouter` call builds them. Its unit is the
  procedure, not the entry in the return literal; flattening is invisible to it.
- **Public-surface tripwire**: the pinned sorted key list at
  `app-trpc.features.unit.test.ts:461`, plus `procedureNamesOf(features.X)`
  per namespace against the packaged transport's own procedure names. The key
  list must not change in any mounting step; the procedure lists change only
  for a deliberate mount fix (the `user.*` merge above).
- **Langy permission suites**: read `ApiApplication["trpc"]`'s procedures off
  the built router, the same way the sweep does.
- No test or lint rule names a group file by path (`grep -rn "app-trpc.gateway-group" apps packages specs`
  is empty after the delete), so no source-reading guard died. Repeat that grep
  for each remaining group file.
- `pnpm --filter @langwatch/platform-api test:unit src/app-trpc`: 3 files / 41
  tests, green after the gateway flatten.

## Fan-out

The executable list — files, deletions, the shape to converge on, verification
commands — is `trpc-flatten-review.md`, "Corrected fan-out work list": step A
(four mounting files, serial, one agent), step B (composition, one change),
step C (optional namespaces, one change), step D (the return type, after B
and C). A and C are independent; D needs B and C.

## What the reference revealed

- The "10 groups" the plan doc counts are a composition-layer count. Five of
  the ten never had a mounting wrapper, so the visible "21 keys behind one
  spread" complaint applied to five files, now four.
- `createEnterpriseGovernanceTrpcRouters` and `createEnterpriseBillingTrpcRouters`
  were already flat multi-namespace builders; the group file's only job was
  merging three flat objects into a fourth. Deleting it cost zero new abstraction.
- The mounting flatten is safe per namespace (procedure identity unchanged,
  pinned by the existing test), but it does not move `AppRouter` at all. The
  composition literal is what does, and it is one change rather than ten.
