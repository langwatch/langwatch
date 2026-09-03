# Flattening the tRPC collaborator groups (option D)

**Written:** 2026-09-03. **Audited:** 2026-09-03 against the working tree.
**Status:** steps A, B and C landed (B and C uncommitted in this worktree). D
is open and needs a typecheck-verified follow-up session — see "Open: step D"
below for exactly what is left and why it was not attempted blind.

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

## Open: step D — the record's real type reaches `AppRouter`

**Not attempted, and not a small follow-up — recording why rather than
guessing at it blind.** `api-trpc-features.composition.ts`'s
`build(mount): TRPCRouterRecord { ...; return createAppTrpcFeatures({ mount,
ports }) as unknown as TRPCRouterRecord; }` is not the only erasure point, and
removing just that cast changes nothing observable: `ApiTrpcFeaturesPort`
(`api.application.ts`) declares `abstract build(mount): TRPCRouterRecord`, and
`ApiApplication.features` is typed as that BASE class, so every caller of
`features.build(...)` sees the abstract signature's `TRPCRouterRecord`
regardless of what the concrete override's body would infer on its own —
`createAppTrpcFeatures`'s real, per-call inferred return type (confirmed
already inference-friendly, no explicit `unknown` defaults exercised at the
one production call site) never reaches a reference typed as the base class.

To let it reach `AppRouter`, `ApiTrpcFeaturesPort` and `ApiApplication` both
need to become generic over the feature record type, threaded from
`ApiApplication.create`'s `features` argument to `this.trpc`. That alone does
not finish it: `AppRouter = ApiApplication["trpc"]` is read UNPARAMETERIZED
(so `apps/ui` needs no knowledge of the concrete composition), which means the
class's type parameter would need a default — and a default resolves to
itself, not to "whatever production instantiates," so the erasure just moves
one level up unless something explicitly names the real instantiation. A
closure-based redesign (`ApiTrpcFeaturesPort` as an interface with a `build`
field assigned inline, the way `composeApiTrpcCollaborators` infers its return
type in step B) is the likelier fix, since class methods can't infer a type
parameter from their own body — but that is a structural rewrite of a
class multiple in-flight agents in this worktree depend on right now, and it
is not verifiable without a typecheck this task explicitly forbids running.

**Separately, and worth knowing before anyone resumes this:** `apps/ui` does
not import or reference `AppRouter` anywhere today
(`grep -rln "AppRouter" apps/ui/src` is empty). `apps/ui/src/behavior/ui-feature-transport.ts`
builds its client from the hand-written `FeatureApiMap`/`RouterFromMap`, not
from `AppRouter`. Fully resolving the erasure above does not, by itself, make
"apps/ui infer every procedure" — that needs a second, separate change
actually switching the transport onto `AppRouter`, which is its own migration
(the api-map retirement the rest of this doc references) and was never in
scope for this lane.

**Resume point for whoever picks this up:** (1) design the closure/interface
shape for `ApiTrpcFeaturesPort<TRecord>` and `ApiApplication<TRecord>` with a
scratch file and `pnpm typecheck` in the loop — not blind; (2) once `AppRouter`
carries real types, separately plan the `apps/ui` transport swap off
`FeatureApiMap`. `open-decisions-2026-09-03.md`, cited by an earlier pass of
this doc as where "`features` required" was decided, does not exist in this
repo — that decision is not recorded anywhere and needs to be made (or
re-made) explicitly when this resumes, since the generic redesign above
changes what "required" even means for `features`.

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
