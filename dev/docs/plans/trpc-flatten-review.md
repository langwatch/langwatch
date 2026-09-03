# Review: flattening the tRPC groups

**Reviewed:** 2026-09-03. **Audited:** 2026-09-03 against the working tree.
**Verdict then:** approve with fixes. **State now:** fix list closed, steps A
and B landed, steps C and D open.

## Landed

- **Fixes 1–6 and step A** — `3edf367d5a` (gateway, product-infra) and
  `0acdb3f67c` (org, agent, trace). All five `app-trpc.*-group.ts` files are
  deleted, every group's ports interface dissolved into top-level entries, and
  the pinned key list is unchanged.
- **Step B** — the same two commits. `grep -rn "sealApiTrpcCollaborators\|withApi[A-Za-z]*Collaborators\|AnyApiTrpcCollaborators" apps/api/src`
  finds only two stale re-export lines (see the defect below) and one comment.
  `composeApiTrpcCollaborators(halves, gapLogger)` is the single call at
  `api-production.composition.ts:923`.
- **Fix 3** — the `personalDashboard` mount fix landed with the flatten rather
  than as its own commit, and is recorded in `trpc-flatten-design.md`.

## Open: step C — `agents` and `secrets` required

Not started. Files: `apps/api/src/api.application.ts` (create signature at
`:399-421`, the conditional spreads at `:424-431`, `unavailableAgents` /
`unavailableSecrets` / `requireServices`), `app-trpc.types.ts` (becomes
`export type AppRouter = ApiApplication["trpc"];` plus its docblock), and the
test call sites of `ApiApplication.create(` that omit one or both
(`grep -rl "ApiApplication.create(" apps/api/src --include='*.test.ts'`), which
pass `new MissingAgentService()` / `new MissingSecretService()` — export the
two classes for that, which is the plainer shape.

Verification: `grep -n "PinPresent\|RawAppRouter" apps/api/src/app-trpc/app-trpc.types.ts`
prints nothing; `pnpm --filter @langwatch/platform-api test:unit src/__tests__`.

## Open: step D — the record's real type reaches `AppRouter`

Needs C first. `api-trpc-features.composition.ts:277` drops the
`as unknown as TRPCRouterRecord` cast; `ApiTrpcFeaturesPort.build` and
`ApiApplication.buildFeatureRouters` return `AppTrpcFeatureRecord`, exported
from `app-trpc.features.ts` as the return type of `createAppTrpcFeatures`
instantiated with the process's own mount types. The type parameters still on
`ApiTrpcCollaborators` (`app-trpc.collaborators.ts:156`) and
`AppTrpcFeaturePorts` (`app-trpc.features.ts:316`) go in the same change —
they are what instantiates 14 entries as `unknown` and therefore what still
blocks a real return type.

**The one decision is Alex's** (decision 3 in
`open-decisions-2026-09-03.md`):

- (i) `features` required. Consistent with C and with the codebase's
  preference for null objects over optionality. Cost: the test call sites that
  build an `ApiApplication` without a features port need a small
  `TestApiTrpcFeatures` that mounts an empty-but-typed record.
  **Recommended, with the cost stated.**
- (ii) `features` stays optional at runtime and `AppRouter` is declared in
  `app-trpc.types.ts` from `AppTrpcFeatureRecord` plus the two own routers
  rather than read off the class. Cheaper; loses "can never drift from what the
  process actually mounts" unless a type-level test pins
  `ApiApplication["trpc"]` assignable to `AppRouter`.

Whichever is ruled, the mount type parameters on `createAppTrpcFeatures`
(`TContext`, `TOptions`, `TRoot`) exist for the unit test's `initTRPC` root
only. If the unit test can build an `ApiTrpcContext`-shaped mount, delete them
and take `ApiTrpcFeatureMount` directly; otherwise keep them and export
`type AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures<ApiTrpcContext, …>>`
(an instantiation expression, no cast).

Verification: `grep -rn "TRPCRouterRecord" apps/api/src/api.application.ts apps/api/src/app/api-trpc-features.composition.ts`
prints nothing; a browser package's `trpcReact.user.personalUsage.useQuery`
type-checks against `AppRouter` — that is the api-map lane's first conformance
assertion and the measure this lane is finished by.

## Defect left by step B

`apps/api/src/index.ts:40` and `:53` re-export
`withApiTraceGroupCollaborators` and `withApiGatewayGroupCollaborators` from
`api-trpc-collaborators.{trace,gateway}-group.composition.ts`. Step B deleted
both functions and no definition exists anywhere in the repository, so
`@langwatch/platform-api` does not compile. Delete the two export lines.
