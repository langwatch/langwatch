# Review: flattening the tRPC groups (gateway reference)

**Reviewed:** 2026-09-03, `feat/strict-feature-layout-v0`, the uncommitted diff to
`apps/api/src/app-trpc/**`, `apps/api/src/app/api-trpc-collaborators.gateway-group.composition.ts`
and `apps/api/src/features/enterprise/enterprise-governance-trpc.mount.ts`, against
`dev/docs/plans/trpc-flatten-design.md`. Suite run:
`pnpm --filter @langwatch/platform-api test:unit src/app-trpc` — 3 files / 41 tests green
(the design doc's "171 tests / 5 files" does not describe this path).

## Verdict: approve with fixes

The mounting half is right and small: `app-trpc.gateway-group.ts` is gone, the 21
namespaces are one line each in `app-trpc.features.ts`, the pinned key list is
unchanged, no new abstraction, no `as unknown as` added. That part is the shape
the other four mounting files should converge on.

It does not yet do what the lane was asked. Measured against the goal —
"one independent registration per feature, `AppRouter` carries every
procedure, no `TRPCRouterRecord` erasure between a feature router and
`AppRouter`" — the reference lands the first clause for one group and leaves
the other two exactly where they were, then writes a design doc that defends
leaving them there. Four of that doc's load-bearing claims are wrong (fixes 1, 3, 6 and 7
below), and the fan-out plan it hands Sonnet says "same shape repeats" without
naming the shape for the composition layer, which is the 8,262-line half.

```
                        BEFORE            REFERENCE           GOAL
mounting layer          5 group files     4 group files       0
ports bag on the        gatewayGroup      gatewayGroup        none: gateway,
ports interface         (3 entries)       (3 entries)         governanceHome,
                                          + 15-line TEMPORARY saasBilling top-level
                                            SEAM comment
composition folds       10 withApi* +     10 withApi* +       one object literal
                        seal              seal
type erasure            AnyApiTrpc-       unchanged           ApiTrpcCollaborators
                        Collaborators                         concrete, no params
                        (19 params→unknown)
build() return          TRPCRouterRecord  unchanged           AppTrpcFeatureRecord
                        (as unknown as)
agents/secrets          optional spreads  unchanged           unconditional
AppRouter               PinPresent repair unchanged           ApiApplication["trpc"]
```

Approve because the mounting reference is reusable as written. Fixes because
the seam it introduces must not outlive this lane, one behaviour change is
mislabelled as a refactor, and the plan the fan-out agents will read needs the
composition-layer shape written down before anyone starts.

## Fix list

Implementation files first, then the design doc (already edited — see the end).

1. **Delete the ports bag now, in this lane.**
   `apps/api/src/app-trpc/app-trpc.features.ts:205-230` (`AppGatewayGroupTrpcContext`,
   `AppGatewayGroupTrpcPorts`, `AnyAppGatewayGroupTrpcPorts`) and
   `:264-281` (`TGatewayGroup` param + `gatewayGroup: TGatewayGroup`). Replace with
   three top-level entries on `AppTrpcFeaturePorts`: `gateway: GatewayTrpcPorts`,
   `governanceHome: GovernanceHomeTrpcPorts`, `saasBilling: boolean`. Drop the
   `TGatewayGroup` parameter at `:604` and `:629`, and in
   `app-trpc.collaborators.ts:140`, `:291`, `:373`. Inline the four context types
   into the `TContext` constraint at `:575-580` (they are already intersected
   there; the alias adds nothing). The doc's reason for deferring this — that
   changing `composeApiGatewayGroupCollaborators`'s shape "ripples into every
   other group's fold order" — is false: each `withApi*Collaborators` spreads
   `...base` and adds its own keys, the chain's own comment says they compose
   in any order, and `withApiGatewayGroupCollaborators` is the outermost call.
   The edit touches five lines outside `app-trpc/`:
   - `apps/api/src/app/api-trpc-collaborators.gateway-group.composition.ts:142-143`
     `ports: AnyAppGatewayGroupTrpcPorts` → `gateway`, `governanceHome`, `saasBilling`
     as three fields on `ApiGatewayGroupCollaborators`; `:372` `gatewayGroup: group.ports`
     → three lines.
   - `apps/api/src/app/api-trpc-ports.composition.ts:385-392` → `gateway: collaborators.gateway`,
     `governanceHome: collaborators.governanceHome`, `saasBilling: collaborators.saasBilling`;
     delete the seven-line "twenty-one gateway and governance surfaces" comment.
   - `apps/api/src/app/api-trpc-collaborators.product.composition.ts:443`
     `REQUIRED_COLLABORATORS`: `"gatewayGroup"` → `"gateway"`, `"governanceHome"`,
     `"saasBilling"` (`false !== undefined`, so the seal still passes self-hosted).
   - Tests: `app-trpc.features.unit.test.ts:399-407` fixture (three top-level
     entries, and the `as unknown as AnyAppGatewayGroupTrpcPorts` cast goes with
     the type); `apps/api/src/app/__tests__/api-trpc-features.composition.integration.test.ts:323-325`;
     `apps/api/src/app/__tests__/api-trpc-collaborators.gateway-group.integration.test.ts:445-451`
     ("names the three port groups the half fills") asserts the three keys on
     the half's return instead of on a nested `ports`.

2. **Comments over five lines, and history in comments.**
   - `app-trpc.features.ts:266-280` — the 15-line `TEMPORARY SEAM` block. Deletes with fix 1.
   - `app-trpc.features.ts:205-213` — nine lines on the context alias. Deletes with fix 1.
   - `app-trpc.features.ts:633-635` — "used to be wrapped by a single
     `createAppGatewayGroupTrpcFeatures`". That is git history, not help reading
     the code. Delete; the three `const` lines explain themselves.
   - `app-trpc.features.ts:677-683` — seven lines on the governance entries. Cut
     to the one fact a reader needs here: `personalDashboard` is not mounted
     under its own name, see `user:`. The "arrive together or not at all / one
     composition seam" story already lives in `enterprise-governance-trpc.mount.ts`.
   - `apps/api/src/features/enterprise/enterprise-governance-trpc.mount.ts:29-38` —
     eight lines under "Why `personalDashboard` is returned but not mounted here".
     Cut to five.

3. **`personalDashboard` is a behaviour change, not a flatten. Keep it, name it, split it.**
   Before this diff `createEnterpriseGovernanceTrpcRouters` returned thirteen
   routers and `personalDashboard` was mounted nowhere
   (`git show HEAD:apps/api/src/features/enterprise/enterprise-governance-trpc.mount.ts`
   has no `personalDashboard` in its return; `HEAD:app-trpc.features.ts:733` is
   `user: createUserTrpcRouter(...)` alone). After it, `user.*` gains
   `personalUsage`, `budgetOverview` and `cliBootstrap`, and the unit test's
   pinned procedure list changes accordingly. This is the right fix — the /me
   screen calls them today
   (`packages/features/user/web/src/behavior/use-personal-context.ts:128,138`)
   and got not-found — but the design doc says "Nothing about *what* is mounted
   changed", which is false, and the old test comment it replaced said a copy
   appearing would mean a second owner. Commit it separately as "Mount the
   Enterprise /me dashboard reads on `user.*`" with the test change and the
   mount docblock change, so the flatten commit is what its message says.
   Note the `HEAD` comment at `app-trpc.features.ts:730-732` already claimed
   the merge happened; the code now matches it, which is the correct direction.

4. **Do not sweep another lane's edit into this commit.**
   `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts` (+5,
   `createSuiteRunModelsResolver`) is the scenario rebind lane's, not the
   flatten's. Commit by pathspec.

5. **The design doc's test evidence.** "171 tests / 5 files" and "49 files / 528
   tests" do not match `pnpm --filter @langwatch/platform-api test:unit src/app-trpc`
   (3 files / 41 tests). State the command and the number it prints.

6. **Optional namespaces contradict what the lane was left.**
   `install-composition-review-2026-09-03.md` §5 handed this lane one job on
   `app-trpc.types.ts`: when `ApiApplication.create` stops spreading optional
   namespaces, `PinPresent` deletes and `AppRouter = ApiApplication["trpc"]`
   becomes the whole file. The design doc instead argues the conditional spreads
   at `api.application.ts:435-441` are "about as flat as it gets" and leaves
   them. Fix: `ApiApplication.create` takes `agents: AgentService` and
   `secrets: SecretService` required; `api.process.ts:78-80` already always
   passes both. `MissingAgentService` (`api.application.ts:202`) and
   `MissingSecretService` (`:285`) already exist as the null objects for a
   process that composed neither, so the 20 test call sites that omit them pass
   those, `unavailableAgents`/`unavailableSecrets` and `requireServices()`
   (`:373-380`, `:515-520`) delete, the router literal has no spreads, and
   `app-trpc.types.ts` shrinks to one line. Then `AppRouter` still carries an
   erased record — that is fix 7.

7. **The erasure is not blocked on the other groups; the doc says it is.**
   `apps/api/src/app/api-trpc-features.composition.ts:264`
   (`as unknown as TRPCRouterRecord`) and `api.application.ts:199`
   (`abstract build(mount): TRPCRouterRecord`) are the two lines between every
   feature router and `AppRouter`. The doc says removing them must wait "until
   the last of the nine groups lands" because mounting flatness is a
   precondition — then admits in the same paragraph that
   `createAppTrpcFeatures`'s return type "is already fully inferred and
   unaffected". Both cannot be true; the second is. What actually blocks a real
   return type is the *composition-layer* erasure: the fold chain casts to
   `AnyApiTrpcCollaborators`, which instantiates 14 of the 19 type parameters
   as `unknown`, so a `ReturnType<typeof createAppTrpcFeatures>` today would
   carry `unknown` outputs for bug reports, data privacy, experiments,
   analytics inputs and the rest. That is why the api-map retirement is still
   blocked after this reference, and why the composition layer is not optional
   follow-up work. The concrete plan is Group 0 in the work list below.

## What the reference gets right (keep)

- The two-layer taxonomy (mounting groups vs. composition groups) is correct
  and useful; five of the ten composition groups never had a mounting file.
- The per-feature entry shape — a plain key on the object literal, one builder
  call, no `{ name, mount }` registry, no loop — is what Alex asked for.
- The declared-check sweep (`app-trpc.declared-check.ts`), the public-surface
  tripwire (the pinned key list at `app-trpc.features.unit.test.ts:461`) and
  the Langy permission suites read procedures off the built router, not off
  the source structure of `app-trpc.features.ts`, so flattening is invisible
  to all three. Verified: the pinned key list is unchanged and the suite is
  green. No test or lint rule names `app-trpc.gateway-group` by path
  (`grep -rn "app-trpc.gateway-group" apps packages specs` is empty), so no
  source-reading guard died on the delete.
- `createEnterpriseGovernanceTrpcRouters` and `createEnterpriseBillingTrpcRouters`
  were already flat multi-namespace builders; the group file was pure
  indirection and deleting it cost nothing.

## Corrected fan-out work list

Two facts reorder the plan. First, the composition layer is not ten changes
but one: the target shape is a single object literal replacing the fold chain,
and doing it "per group through the fold" keeps the chain, the seal and the
casts alive until the last group. Second, the composition change is what
unblocks `AppRouter`, so it is not the tail of the plan — it is the middle.

```
Step A  mounting (4 files, serial, one agent)        app-trpc.*-group.ts → deleted
Step B  composition (1 change, one agent)            10 folds + seal → 1 literal
Step C  optional namespaces (1 change)               agents/secrets required, PinPresent deleted
Step D  the return type (1 change, needs B and C)    build(): AppTrpcFeatureRecord
```

A and C are independent of each other and of B; B and C must land before D.
A can run in parallel with B only if they are different agents on different
files — both edit `app-trpc.features.ts`'s ports interface, so prefer A then B.

### Step A — mounting layer: the four remaining group files

One agent, serial, in this order (smallest first). Shape: exactly the gateway
reference after fix 1 — builders called at the top of `createAppTrpcFeatures`,
one key per namespace in the return literal, each group's ports interface
dissolved into top-level entries on `AppTrpcFeaturePorts` (and the same names
on `ApiTrpcCollaborators`, `createApiTrpcPorts` and `REQUIRED_COLLABORATORS`),
each group's `App*TrpcContext` alias inlined into the `TContext` constraint at
`app-trpc.features.ts:570-582`, the group's `T*Group` type parameter deleted.

| # | Delete | Lines | Namespaces to list | Ports entries that go top-level | Composition fold line to change | Tests to update |
| - | ------ | ----- | ------------------ | -------------------------------- | -------------------------------- | --------------- |
| A1 | `apps/api/src/app-trpc/app-trpc.product-infra.ts` | 115 | dataRetention, monitors, storedObjects | `dataRetention`, `monitors` (`AppProductInfraTrpcPorts:58-88`; `storedObjects` takes none) | `api-trpc-collaborators.product-infra.composition.ts:241-254` | `app-trpc.features.unit.test.ts:388-398`; `api-trpc-collaborators.product-infra.integration.test.ts` |
| A2 | `apps/api/src/app-trpc/app-trpc.org-group.ts` | 209 | 9 (`createAppOrgGroupTrpcFeatures:169` return) | `AppOrgGroupTrpcPorts:101-157` — `organization`, `organizationAuditLogCheck`, `project`, `projectChecks`, `codingAgents`, `automation`, `emailSuppression`, `enterprise` | `api-trpc-collaborators.org-group.composition.ts:1252-1264` | `app-trpc.features.unit.test.ts:333-355`; `api-trpc-collaborators.org-group.integration.test.ts` |
| A3 | `apps/api/src/app-trpc/app-trpc.agent-group.ts` | 244 | 6 (`createAppAgentGroupTrpcFeatures:172` return) | `AppAgentGroupTrpcPorts:99-164` | `api-trpc-collaborators.agent-group.composition.ts:535-550` | `app-trpc.features.unit.test.ts:315-332`; `api-trpc-collaborators.agent-group.integration.test.ts` |
| A4 | `apps/api/src/app-trpc/app-trpc.trace-group.ts` | 322 | 16 (`createAppTraceGroupTrpcFeatures:270` return) | `AppTraceGroupTrpcPorts:151-245` — 13 entries; carries its own type params, which resolve to concrete types in `api-trpc-collaborators.trace-group.composition.ts` | `api-trpc-collaborators.trace-group.composition.ts:583-600` | `app-trpc.features.unit.test.ts:356-387`; `api-trpc-collaborators.trace-group.integration.test.ts` |

Per group, the diff to `app-trpc.features.ts` is: N imports of the feature
builders, N `const` lines above the return, N keys in the return, minus one
import, one spread and one grouped comment. Where a namespace has two owners
on one wire name (the gateway reference's `governance`), merge with
`mount.root.mergeRouters` in the return literal, the way `governance:` and
`user:` do now.

A namespace key inside a group whose name is also a ports entry (for example
trace-group's `traces`) keeps the same name on both; that is not a collision,
one is the router and one is what it needs.

Verification, per group:

```bash
pnpm --filter @langwatch/platform-api test:unit src/app-trpc
pnpm --filter @langwatch/platform-api test:unit src/app/__tests__/api-trpc-collaborators.<group>.integration.test.ts src/app/__tests__/api-trpc-features.composition.integration.test.ts
grep -rn "app-trpc.<group>" apps packages specs dev   # must print nothing
grep -n "\.\.\.createApp" apps/api/src/app-trpc/app-trpc.features.ts   # one fewer each time; zero after A4
```

The pinned key list at `app-trpc.features.unit.test.ts:461` must not change in
any A step — if it does, a namespace was renamed or lost.

### Step B — composition layer: one literal, no folds, no seal, no erasure

One agent, one change. The ten `composeApi*Collaborators` functions stay:
they are where ports are actually built from the process graph, and their
return types are already concrete (for example
`api-trpc-collaborators.product.composition.ts:200-204` names
`BugReportTrpcPorts<BugReportListing, BugReport>` and
`DataPrivacyTrpcPorts<DataPrivacySnapshot, DataPrivacyPolicy>`). What goes is
everything that erases them on the way to `createAppTrpcFeatures`:

Delete:
- the ten `withApi*Collaborators` functions (one per `api-trpc-collaborators.*.composition.ts`, listed above and at `product.composition.ts:413`, `analytics:539`, `execution:878`, `identity:1311`, `product-group:507`, `trace-group:583`, `agent-group:535`, `org-group:1252`, `product-infra:241`, `gateway-group:365`) and their `as [unknown as] AnyApiTrpcCollaborators` casts;
- `sealApiTrpcCollaborators`, `REQUIRED_COLLABORATORS`, `REQUIRED_APPLICATION_SLICES`, `ApiTrpcCollaboratorGapReport` (`product.composition.ts:430-536`) and `LoggedApiCollaboratorGap` (`api-production.composition.ts:3997-4010`, used at `:972`) — a concrete type is the seal;
- `AnyApiTrpcCollaborators` (`app-trpc.collaborators.ts:340-374`) and the 19 type parameters on `ApiTrpcCollaborators` (`:128-150`) — the interface names the concrete types the compose functions already return;
- the matching 22 type parameters on `AppTrpcFeaturePorts` (`app-trpc.features.ts:242-265`) and `createAppTrpcFeatures` (`:538-631`) — the ports interface names the same concrete types; the mount parameters (`TContext`, `TOptions`, `TRoot`) stay for now (Step D decides them);
- the 14 type parameters on `ApiTrpcFeaturesComposition` and `tryCompose` (`api-trpc-features.composition.ts:150-225`);
- `options.trpcCollaborators` (`api-production.composition.ts:412`, used only at `:951`): an optional seed nobody passes. Inert, delete.

Replace `api-production.composition.ts:938-972` with:

```ts
const halves = {
  product: this.composedProduct,
  analytics: this.composedAnalytics,
  identity: this.composedIdentity,
  execution: this.composedExecution,
  productGroup: this.composedProductGroup,
  traceGroup: this.composedTraceGroup,
  agentGroup: this.composedAgentGroup,
  orgGroup: this.composedOrgGroup,
  productInfra: this.composedProductInfra,
  gatewayGroup: this.composedGatewayGroup,
};
const collaborators = composeApiTrpcCollaborators(halves, gapLogger);
```

where `composeApiTrpcCollaborators` (new, in `api-trpc-features.composition.ts`
beside `tryCompose`, ~60 lines) does `if` any half is `undefined`, log the
missing names and return `undefined` (the all-or-nothing rule, now one `if`);
otherwise return the literal `{ application: { ...product.application, ...analytics.application, … }, annotation: product.annotationPorts, bugReports: product.bugReportPorts, … }`
— one line per `ApiTrpcCollaborators` key, typed as `ApiTrpcCollaborators`, no
cast. If the literal misses a key the compiler says which one; that is what the
runtime seal was for. The `composed*` fields' types are already the concrete
`Api*Collaborators` types.

Verification:

```bash
grep -rn "as unknown as AnyApiTrpcCollaborators\|as AnyApiTrpcCollaborators\|AnyApiTrpcCollaborators\|sealApiTrpcCollaborators\|withApi[A-Za-z]*Collaborators" apps/api/src   # must print nothing
pnpm --filter @langwatch/platform-api test:unit src/app-trpc src/app/__tests__
```

`api-trpc-features.composition.integration.test.ts` and the ten
`api-trpc-collaborators.*.integration.test.ts` suites each currently call the
fold or the seal somewhere; they switch to `composeApiTrpcCollaborators` or to
asserting on the compose function's return directly. No test asserts on the
seal's gap report by prose; if one does, it asserts on the missing-name list.

### Step C — `agents` and `secrets` are not optional

Fix 6 above, as its own change. Files: `api.application.ts:382-441` (create
signature, constructor, router literal), `:373-380` and `:515-520`
(`unavailableAgents`, `unavailableSecrets`, `requireServices` delete),
`app-trpc.types.ts` (becomes `export type AppRouter = ApiApplication["trpc"];`
plus its docblock), and the 20 test call sites of `ApiApplication.create(`
(`grep -rl "ApiApplication.create(" apps/api/src --include='*.test.ts'`) that
omit one or both, which pass `new MissingAgentService()` /
`new MissingSecretService()` — export the two classes for that, or give
`ApiApplication` a `createWithoutServices` used only by tests; the former is
the plainer Go shape.

Verification: `grep -n "PinPresent\|RawAppRouter" apps/api/src/app-trpc/app-trpc.types.ts`
prints nothing; `pnpm --filter @langwatch/platform-api test:unit src/__tests__`.

### Step D — the record's real type reaches `AppRouter`

After B and C. `api-trpc-features.composition.ts:264` drops the cast;
`ApiTrpcFeaturesPort.build` (`api.application.ts:199`) and
`ApiApplication.buildFeatureRouters` (`:453`) return `AppTrpcFeatureRecord`,
exported from `app-trpc.features.ts` as the return type of
`createAppTrpcFeatures` instantiated with the process's own mount types.

One decision here is Alex's, not Sonnet's, and it should be taken before D
starts: `ApiApplication.create`'s `features` is optional today, and
`buildFeatureRouters` returns `{}` without it. If the record has a real type,
a router built without it is a different type, and `AppRouter = ApiApplication["trpc"]`
can only be the full router if `features` is required. Options:

- (i) `features` required. Consistent with C, and with the codebase's stated
  preference for null objects over optionality (`MissingAgentService`). Cost:
  the test call sites that build an `ApiApplication` without a features port
  need a small one — `ApiTrpcFeaturesComposition` is 290 lines and needs a
  Prisma client, so those tests would want a `TestApiTrpcFeatures` that mounts
  an empty-but-typed record. Recommended, with the cost stated.
- (ii) `features` stays optional at runtime and `AppRouter` is declared in
  `app-trpc.types.ts` from `AppTrpcFeatureRecord` plus the two own routers
  rather than read off the class. Cheaper; loses "can never drift from what
  the process actually mounts" unless a type-level test pins
  `ApiApplication["trpc"]` assignable to `AppRouter`.

Whichever is ruled, the mount type parameters on `createAppTrpcFeatures`
(`TContext`, `TOptions`, `TRoot`) exist for the unit test's `initTRPC` root
only. If the unit test can build an `ApiTrpcContext`-shaped mount, delete them
and take `ApiTrpcFeatureMount` directly; if it cannot, keep them and export
`type AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures<ApiTrpcContext, …>>`
(an instantiation expression, no cast).

Verification: `grep -rn "TRPCRouterRecord" apps/api/src/api.application.ts apps/api/src/app/api-trpc-features.composition.ts`
prints nothing; a browser package's `trpcReact.user.personalUsage.useQuery`
type-checks against `AppRouter` — that is the api-map lane's first
conformance assertion (`install-composition-review-2026-09-03.md` §5) and is
the measure this lane is finished by.

## Design doc

`dev/docs/plans/trpc-flatten-design.md` is edited in place: the "Nothing
about what is mounted changed" claim, the "Temporary seam" section's ripple
argument, the "Conditional namespaces" section, the `build()` section's
dependency claim and the fan-out table are replaced with what this review
found. The two-layer taxonomy, the before/after diagram and the per-feature
entry shape are kept.
