# Flattening the tRPC collaborator groups (option D)

**Written:** 2026-09-03. **Audited:** 2026-09-03 against the working tree.
**Status:** steps A and B landed. Steps C and D are open, and D carries a
ruling for Alex.

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
the return statement already *is* the registry. Where one wire name has two
owners (`governance`, `user`), the merge is a `mount.root.mergeRouters` in the
return literal, so nothing outside the list can add a third door onto the same
name.

## Open: step C — `agents` and `secrets` are not optional

Not started. `apps/api/src/api.application.ts:399-421` still declares
`agents?`, `secrets?` and `features?` on `ApiApplication.create`, still spreads
them conditionally, and `app-trpc.types.ts:17-44` still carries the
`PinPresent` repair over `RawAppRouter`.

The change: `create` takes `agents: AgentService` and `secrets: SecretService`
required — `api.process.ts` already always passes both. `MissingAgentService`
(`api.application.ts:207`) and `MissingSecretService` (`:302`) already exist as
the null objects, so the ~20 test call sites that omit them pass those;
`unavailableAgents`, `unavailableSecrets` and `requireServices()` delete, the
router literal loses its spreads, and `app-trpc.types.ts` shrinks to
`export type AppRouter = ApiApplication["trpc"];`.

Verification: `grep -n "PinPresent\|RawAppRouter" apps/api/src/app-trpc/app-trpc.types.ts`
prints nothing; `pnpm --filter @langwatch/platform-api test:unit src/__tests__`.

## Open: step D — the record's real type reaches `AppRouter`

Not started; needs C first. `api-trpc-features.composition.ts:277` still ends
in `as unknown as TRPCRouterRecord`, and `ApiTrpcCollaborators`
(`app-trpc.collaborators.ts:156`) and `AppTrpcFeaturePorts`
(`app-trpc.features.ts:316`) still carry the type parameters that instantiate
14 of them as `unknown`. Until those go, a real `ReturnType` carries `unknown`
outputs for bug reports, data privacy, experiments and the analytics inputs,
which is what still blocks the api-map retirement.

**Decision for Alex, before D starts.** `features` is optional today and
`buildFeatureRouters` returns `{}` without it, so `AppRouter =
ApiApplication["trpc"]` is only the full router if `features` is required.
Options (i) make it required, (ii) keep it optional and declare `AppRouter`
from the record type with a type-level pin. The design recommends (i); it is
decision 3 in `open-decisions-2026-09-03.md` and is Alex's to overturn.

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

`apps/api/src/index.ts:40,53` still re-export `withApiTraceGroupCollaborators`
and `withApiGatewayGroupCollaborators`, which step B deleted. Nothing in the
repository defines either name. Delete both export lines — this is a live
compile error in `@langwatch/platform-api`.
