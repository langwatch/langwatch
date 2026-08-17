# ADR-092 delivery plan - unified authorization engine, end to end

**Companion to:** `dev/docs/adr/092-unified-authorization-engine.md` (the what and why)
**Spec:** `specs/rbac/unified-authorization-engine.feature` (the behavioural contract)
**This document:** the how - every stage sliced into PRs, with gates, flags,
rollback, and the open decisions that block each stage.

**Restructured 2026-08-17 (Alex's call), replacing the stage-by-stage
fleet-wide rollout.** The ADR's stages A-F survive as a description of the
WORK, but they are no longer the unit of ROLLOUT. Three rules now govern
delivery:

1. **Everything ships to production dark.** All the code an organization
   needs to run on the engine lands in production first, gated closed for
   every tenant. Nothing about anyone's behaviour changes when it deploys.
2. **An organization cuts over all at once.** There is no partial state. One
   composite migration rewrites that org's data - TeamUser rows, `roleKey`
   on every binding, custom roles, lite-member, legacy keys - proves parity,
   and flips the org onto the engine in a single transition. A tenant is on
   the old flow or the new one, never half.
3. **Every deletion waits for 100%.** The `roleKey` NOT NULL tighten, the
   four `LEGACY-QUIRK(C)` branches, the `.permission()` codemod, deleting
   `rbac.ts`, dropping `TeamUser` - all of it collects into a final contract
   phase that only starts once every tenant is finalized. Nothing is deleted
   while a single organization still reads it.

**The fork replaces the codemod** (same decision). Stage D was going to
codemod ~380 `.use(...)` call sites onto `.permission()` before enforcement
could flip. It does not need to: the shadow already instrumented every
decision point. Ten call sites across `rbac.ts` and `role-binding-resolver.ts`
carry every legacy permission decision, and each already calls
`authzShadowFor(...)`. Turning those into a per-organization fork - engine
decides for a migrated org, legacy decides for everyone else, the other one
runs as the shadow either way - is a change inside two files. The codemod
still happens, but it becomes cosmetic cleanup in the contract phase,
attempted only once the new direction is proven in production.

**Data migrations stay in-place**: the system migrates its own data at worker
boot - a leased runner (`@langwatch/system-migrations`) walks every
organization through `pending → migrated → finalized` (parked on error), one
driver fleet-wide. Self-hosted installations migrate silently in the
background with no operator action; cloud is paced through
`SYSTEM_MIGRATIONS_COHORT` (unset = nothing, org list, or `all`). Nothing
ships as a runnable script. The ops dashboard (Migrations page) shows every
tenant's state and can kick a pass. The identity-platform program is the
expected second consumer of the runner (its D01 Account backfill and D09
per-customer migrations).

## The shape of the whole thing

```text
 PHASE 1 · BUILD DARK                        everything in prod, gate closed
 ┌──────────────────────────────────────────────────────────────────────┐
 │ roleKey column + dual-read      lite-member as a role                │
 │ legacy-key compatibility        ShareLink permission column          │
 │ grants.* write service          useCan / effectivePermissions        │
 │ THE FORK at the 10 shadow seams (per-org, decides which engine)      │
 └──────────────────────────────────────────────────────────────────────┘
                                   │  no behaviour change for anyone
                                   ▼
 PHASE 2 · CUT OVER, ONE ORG AT A TIME       our org first, in production
 ┌──────────────────────────────────────────────────────────────────────┐
 │ ONE composite migration per organization:                            │
 │   TeamUser → bindings · roleKey on every binding · custom roles       │
 │   rewritten · EXTERNAL → lite-member · legacy keys → bindings         │
 │   ─────────── parity proof ───────────                               │
 │   finalized → that org is on the engine; legacy becomes the shadow    │
 │ rollback = write `rolled_back`, back on legacy inside 15 min          │
 └──────────────────────────────────────────────────────────────────────┘
                                   │  widen the cohort, watch the ops page
                                   ▼
 PHASE 3 · CONVERGE                          every tenant finalized
        held organizations remediated or their diff accepted deliberately
                                   │
                                   ▼
 PHASE 4 · CONTRACT                          only now does anything die
 ┌──────────────────────────────────────────────────────────────────────┐
 │ roleKey NOT NULL · delete the 4 LEGACY-QUIRK(C) branches             │
 │ .permission() codemod · Hono edge identity · delete rbac.ts          │
 │ drop TeamUser · delete the fork and the gate themselves              │
 └──────────────────────────────────────────────────────────────────────┘

 F ACCELERATE (epochs, L1 cache, passports, witnesses) is independent
 performance work and does not gate any of the above.
```

The gates that matter are now per-organization and measurable in one place:
the tenant's own state record, visible on the ops Migrations page.

## Flags and kill switches

```text
 AUTHZ_V2_SHADOW        stage A    run engine alongside legacy, log mismatches,
                                   never affect responses (sampled, default 100%
                                   in dev/staging, 10% cloud)
 AUTHZ_V2_ENFORCE       stage D    engine is primary, legacy runs as the shadow
                                   (reverse-shadow); 0 = instant revert to legacy
                                   until stage E deletes legacy entirely
 AUTHZ_LEGACY_KEY_ENFORCE  RETIRED  never shipped. D2 decided there is no
                                   legacy-key sunset, so there is no window to
                                   stage and no enforcement to flip
 AUTHZ_EPOCH_CACHE      stage F    L1 cache on/off; off = every check collects
                                   (stage-E behaviour, always correct).
                                   PRECONDITION: stays off until M7 holds -
                                   every grant write bumps the org epoch. A
                                   write that skips the bump serves stale
                                   grants, and stale here is fail-OPEN.
```

Env flags, not PostHog flags - authz cannot depend on a third-party flag
service (ADR-005 flags are fine for UI reveals like the Access surface).

Rollback posture per stage: A is additive (delete the module). B and C keep
their source columns/tables until the following stage's gate passes, so
rollback is "re-enable fallback reads". D is `AUTHZ_V2_ENFORCE=0`. E is the
point of no return (legacy deleted) - it only starts after D has run enforced
and quiet for a week. F is `AUTHZ_EPOCH_CACHE=0`.

## Stage A - engine, registry, shadow (no behaviour change)

**Union semantics (was blocker D1):** implemented on this branch, with the
bound scenarios in `specs/rbac/unified-authorization-engine.feature` as the
contract ("Grants are an additive union across scopes", "Narrow access is
expressed by granting less, not by overriding"). Merging the engine PR *is*
the sign-off; the spec's supersession note over the override scenarios in
`scoped-role-bindings.feature` activates when ADR-092 is accepted. Stage A
waits on nothing.

```text
 A1  registry           A2  built-in roles      A3  engine            A4  shadow mode
 packages/authz/src/    packages/authz/src/     packages/authz/src/   wrap the 6 legacy
 registry.ts            roles.ts (viewer/       engine.ts + explain   resolvers, compare,
 + matrix codegen       member/admin/demo…)     + principals + scopes log mismatches

 A5  resource tier
 resource scopes + child closure + audiences + anonymous principal,
 collected from ADR-057's ShareLink rows (no schema change until C5)
```

- **A1 `packages/authz/src/registry.ts`.** All ~32 resources, per-resource actions,
  grantable scopes (absorbs `ORG_EXCLUSIVE_RESOURCES` + a new `platform`
  scope for `ops:*`), manage-implications, UI labels/descriptions/order,
  API-key category mapping, and a **stable bitset index per permission**
  (append-only rule, enforced by a test - stage F's bitmaps depend on
  indices never moving). Derived artefacts: `Permission` type (valid pairs
  only), zod validator, `pnpm authz:matrix` codegen writing
  `dev/docs/authz-matrix.md` (committed, so permission changes show in PR
  diffs).
  *Tests:* every string in `TEAM_ROLE_PERMISSIONS`,
  `ORGANIZATION_ROLE_PERMISSIONS`, `EXTERNAL_MEMBER_PERMISSIONS`,
  `DEMO_VIEW_PERMISSIONS`, `PERMISSION_CATEGORIES`, and
  `permissionsConfig.ts` exists in the registry (the reverse - registry
  entries with no legacy source - is a documented allowlist).
- **A2 `packages/authz/src/roles.ts`.** Built-ins declared as diffs (member =
  viewer + additions, admin = member + additions). *The load-bearing test:*
  generated exhaustive equality against today's bags in `rbac.ts` - every
  (role × permission) cell must match, hierarchy rules included. This is the
  characterisation suite the whole migration leans on.
- **A3 `packages/authz/src/engine.ts`.** Shipped as the pure `@langwatch/authz` package; `platform/app/src/server/authz/` keeps only the app adapters and Prisma composition. `Principal` (`{actor, subject}` pair),
  `ScopeRef`, COLLECT/FILTER/EXPAND/UNION/DECIDE/RECORD, `AuthzDecision`
  with `denialReason` + `audience`, `explain()`, ceiling algebra (`∩`) for
  API keys. Pure core over a collected-bindings input; one Prisma-backed
  collector beside it. (`checkMany` is deliberately NOT here - it has no
  consumer until D2 replaces the batch call sites, and a batch API with no
  caller is a shape guessed rather than measured. It lands in D2.)
  *Tests:* port `rbac.test.ts`, `rbac-integration.test.ts`,
  `role-binding-resolver.unit.test.ts` + integration to run against the
  engine unchanged. Property tests: adding a binding never removes access
  (union monotonicity); org-exclusive permissions never resolve from
  team/project bindings; EXTERNAL cap parity with today's tRPC path
  (deliberately keeping today's asymmetry until C2 fixes it - the shadow
  must match legacy, quirks and all, and each quirk gets a `// LEGACY-QUIRK`
  comment naming its removal stage).
- **A4 shadow mode.** Wrap `resolveProjectPermission`,
  `resolveProjectPermissionAny`, `resolveTeamPermission`,
  `hasOrganizationPermission`, `checkRoleBindingPermission`,
  `resolveApiKeyPermission`, `batchScopePermissions` behind
  `AUTHZ_V2_SHADOW`: after the legacy answer returns, fire the engine async,
  compare, emit `authz_shadow_mismatch_total` (labels: caller, permission,
  scopeType, legacyAnswer) + a structured log with both walks. Never blocks,
  never changes a response.
  All three seams the review round flagged as coverage gaps are wired on
  this branch: `resolveProjectPermissionAny` shadows each evaluated
  candidate (`trpc.projectAny`), `batchScopePermissions` shadows every
  team/project verdict (`trpc.batch`, bounded by the shadow's own per-call
  sampling), and the demo-project early-return fires the comparison before
  returning - the soak measures every resolver branch, including the demo
  path stage E has to move into `server/authz/`.
- **A5 resource tier, shim-backed.** The engine speaks the resource scope
  (`resource trace:t1` under its project) with child closure via the chain
  walk, grant audiences (user / group / api key / members-of team-org-project
  / anyone), and an anonymous principal. Storage is ADR-057's `ShareLink`
  table: the collector reads only links whose token the request PRESENTED
  and which are still live (expiry, view budget), with visibility mapped to
  audience (PUBLIC is anyone, ORGANIZATION the org, PROJECT the project) -
  no schema change until C5, and possession-not-existence survives intact.
  Ships with A1-A3; ShareService keeps writing and view-counting what it
  writes.

**Gate A:** 7 consecutive days of zero unexplained mismatches in staging and
one cloud canary org. Every explained mismatch is either an engine fix or a
`LEGACY-QUIRK` entry. Mismatch dashboard built with gcx before the soak
starts, not after.

## Stage B - the system backfills itself (ONE PR)

Spec: `specs/rbac/in-place-authz-migration.feature`. The old B1/B2/B3 script
sequence became one in-place mechanism:

- **The runner** (`@langwatch/system-migrations`, generic; app composition
  in `platform/app/src/server/app-layer/system-migrations/`): worker boot
  kicks one pass under a Redis lease (single driver fleet-wide), walking
  every cohort organization through `pending → migrated → finalized`, parked
  on error and retried next pass. Self-hosted: every org, no configuration.
  Cloud: `SYSTEM_MIGRATIONS_COHORT` (unset/`none` → nothing, org list, or
  `all`). Ops → Migrations lists per-tenant state and kicks passes by hand.
- **The M1 rider** (`TeamUserBackfillMigration`, in `@langwatch/authz-server`):
  `TeamUser` → TEAM-scoped binding carrying `(role, assignedRoleId →
  customRoleId)`, batch-inserted under the partial unique indexes
  (idempotent), one audit event (`source: backfill-b`) and one epoch bump
  per organization. Personal teams stay team-scoped; `OrganizationUser` is
  NOT promoted to org bindings - today a bare `OrgUser.role=ADMIN` with no
  binding has no admin power, and the backfill preserves today's semantics
  exactly.
- **Finalization is a per-organization parity proof**, not a fleet event:
  collect once per member, decide twice (with and without the legacy rows)
  over every registry permission at the org/team/project scopes the rows can
  reach. Zero disagreements → `finalized`, and the org's legacy fallback
  reads switch off (the `legacy-fallback-gate`, consulted by all three
  rbac.ts fallback branches AND the engine collector, so shadow keeps
  agreeing with legacy). Any disagreement → HELD as `migrated` with the
  diffs in its report: behaviour unchanged, fallback live, re-verified every
  pass so granting the gap heals it. **Held is the expected steady state for
  organizations whose members lean on the legacy org-level union quirk** - a
  team-ADMIN row grants ~95 org-scope permissions a TEAM binding never will,
  so those orgs finalize only after remediation (an explicit org-scope
  binding) or after stage C's re-key shrinks the quirk. Their fate is the
  M2 observed-zero gate, not this PR.
- **What moved to later stages:** deleting the fallback code paths and the
  `virtualKey.authz.ts` / `findOrgAdmins()` reader migrations ride stage E
  (per-org gating makes the code deletion safe only once every org is
  finalized); "stop writing `TeamUser`" is already true everywhere except
  the personal-workspace dual-write, which STAYS until the legacy readers
  are gone (it is the expand-phase posture, not a leftover).

**Gate B:** shadow still silent; parity evidence lives in each org's state
record (the ops page is the report archive); fleet finalization percentage
is a dashboard number, not a launch blocker.

## Stage C - re-key roles, fix the principal escalations

**Unblocked 2026-08-17.** Both sign-offs are closed (D2: no legacy-key
sunset; D3: empty role means deny, with a measured blast radius of zero),
and neither leaves a customer-visible permission change behind. Stage C
waits on nothing.

- **C1 `RoleBinding.roleKey`.** Nullable column, backfilled from
  `(scopeType, role, customRoleId)` → `admin | member | viewer |
  lite-member | custom:<id>`; dual-read window; then NOT NULL and the
  org-scope enum special cases in the engine die (roles become fully
  data-driven).
- **C2 lite-member becomes a role.** EXTERNAL org members get
  `lite-member` at org scope during C1's backfill; SCIM provisioning maps
  seat → roleKey (member vs lite-member) instead of unconditional MEMBER
  (**note: `scim.service.ts` no longer exists - the provisioning path moved
  since this plan was written, and C2 must re-locate it before assuming the
  old line numbers**); the API-key resolver's missing EXTERNAL cap
  (Context #10's escalation) closes by construction because keys and
  sessions now read the same roleKeys. Seat classification stays as billing
  data the engine never reads (coordinate with #3388's licence counting).
  *Regression tests:* lite member's key ≤ lite member's session, on every
  surface.
- **C3 legacy API key compatibility** (was "sunset" - D2 decided against
  one). Old keys keep working forever, with no deadline and no customer
  action. What moves is where their access lives:
  - Backfill every legacy key to explicit bindings mirroring today's
    full-project access. Additive; nothing is revoked.
  - **Read-through minting**: a key that reaches the resolver with no
    bindings (created before the backfill, or a race) mints them from its
    `permissions` JSON on first use rather than being denied. This is what
    makes "old keys work forever" true instead of aspirational, and it is
    the piece that lets the raw-JSON *decision path* die on schedule.
  - `permissions` becomes a dormant column - a source the minter reads,
    never a path `decide()` consults. Keep an `authz_legacy_key_mint_total`
    counter so we can see the tail converge; it is an observation, not a
    gate, and nothing is deleted when it reaches zero.
  - No deprecation header, no comms doc, no `AUTHZ_LEGACY_KEY_ENFORCE`.
  - The zero-binding service-key default-to-org-ADMIN
    (`api-key.service.ts:224-235`) is a separate matter and still gets
    fixed: backfill explicit bindings for existing keys, then require
    bindings at creation. Existing keys keep working - this closes a
    silent escalation for NEW keys, which is not a compatibility break.
- **C4 spec truth-up.** Rewrite `scoped-role-bindings.feature` to union
  semantics; flip the engine spec's now-passing scenarios off
  `@unimplemented`.
- **C5 ResourceGrant storage.** Extend `ShareLink` into the general store
  rather than adding a parallel table - it already carries the anchor
  (resourceType, resourceId, projectId), the audience (visibility) and the
  possession token. Add a `permission` column (default `traces:view`) and
  principal audiences (share to a user / team / group), keep expiry and
  maxViews as the Part III lifecycle. Point `ShareService.resolveForViewer`
  at `authz.check` on the resource scope and delete its bespoke visibility
  check; the A5 reader becomes the one reader. No backfill - the rows are
  already there.

**Gate C:** sign-offs recorded in the PR descriptions; legacy-key usage
metric trending to zero on the canary; escalation regression pack green;
shadow still silent.

## Stage D - one idiom per surface

- **D0 `grants.*` write service** (pulled forward - D, E, F all hook it).
  `attach/update/revoke/replace`, registry validation, audit event per
  write, and the org-epoch bump stubbed (no-op until F). Route all eight
  RoleBinding write paths through it: member add, invites, SCIM, groups,
  API keys, project creation, role editor, better-auth hooks.
  *Definition of done includes the REST error contract.* When `grants.*`
  absorbs the REST write paths it inherits their published failures, and
  `specs/rbac/role-bindings-rest-api.feature` pins a duplicate binding to
  code `role_binding_already_exists` with status 409. `GrantsService` today
  answers `grant_validation_failed` / 400 for the same act, so the two codes
  have to be reconciled before the cutover, not after: an API client
  branching on 409 must not start seeing 400. Same rule for the other pinned
  codes on that surface (`role_binding_principal_invalid`,
  `scope_not_in_organization`, `org_exclusive_permission_scope`, all 422).
- **D1 engine inside the tRPC guards** + `.permission()` sugar on the
  builder. `AUTHZ_V2_ENFORCE` flips the engine to primary with legacy as
  the reverse-shadow for one week. `PermissionDeniedError extends
  HandledError` wired into the tRPC error mapper (and Hono's herr mapping),
  preserving today's lite-member UX messaging via `denialReason`.
- **D2 codemod the attach sites.** 302 project + 76 org + 5 team `.use()`
  sites → `.permission()` (same strings, mechanical, tslsp-assisted); the
  23 `skipPermissionCheck` → `noScopedResources({ reason })` (deep-key
  guard included) and 16 `authorizeInResolver` → `authorizeInService({
  reason })`, each reason written from the surrounding code and reviewed,
  not generated blind. `authz.checkMany` (collect once, decide over many
  scopes) lands here, with the batch call sites the codemod uncovers as its
  first and shaping consumers.
- **D3 Hono edge identity.** One middleware resolves any credential →
  `Principal`; `requirePermission`/`apiKeyPermission` strategies call the
  engine. The ~15 `handlerManagedAuth` blocks collapse, one PR per route
  family: (a) collector + otel, (b) legacy REST traces/annotations/
  evaluations, (c) playground/sse/generate, (d) langy, (e) exports +
  `pages/api/experiment/init.ts`. The REST-vs-tRPC action mismatches
  (`annotations:manage` vs `annotations:create`) get reconciled here,
  registry as referee - each divergence is a one-line decision in the PR.
- **D4 services + authz modules.** `PermissionsService` and the four
  `*.authz.ts` files become policy tables evaluated by `authz.authorize`;
  the `checkPermissionOrPubliclyShared` wrapper becomes
  `.orPublicResource()` on the six tRPC procedures + share routes
  (coordinate with the ADR-057 token-share work, PR #5809 - door 2 should accept
  its signed tokens from day one).
- **D5 non-user principals.** Workers/cron/automations execute with
  explicit service principals; `addEnvs.ts` stops injecting the legacy
  project key into nlpgo payloads and mints a scoped per-project service
  key instead (Langy's `langyApiKey.ts` is the template; nlpgo already
  passes whatever token it is given, so no Go changes are needed for the
  swap - verify with one studio execution end to end).

**Gate D:** CI meta-test lands and passes - every tRPC procedure and Hono
route declares a permission or a reasoned escape, both stacks, no allowlist.
One week enforced with reverse-shadow silent. Grep-gates: no
`hasProjectPermission(` / `checkRoleBindingPermission(` outside
`server/authz/`.

## Stage E - derive everything, delete the monolith

- **E1 frontend cutover.** `authz.effectivePermissions` query (engine
  computed, per org+project, compact string array) + `useCan()` +
  `<RequireCan>`; migrate ~95 inline `hasPermission` calls and 56
  `withPermissionGuard` sites (mechanical rename, same strings); delete the
  client resolver, the client's role-bag imports, the
  `organization.getAll` promotion hack, and the 55 raw client role
  comparisons + endpoint-shape probes (batched by page area: settings,
  dashboard/menu, traces, API-keys UI). Fixes `withPermissionGuard`'s
  fail-open-while-loading as part of the swap (suspend on the query).
- **E2 the Access surface.** Read `dev/docs/best_practices/` first
  (drawers, scope-selector-and-badges, row-actions) per house rules; merge
  members/teams/roles/role-bindings-audit/groups into Settings → Access
  (People & Keys / Roles / Bindings), binding editor = principal picker +
  role picker + ScopeChipPicker, `explain()` drawer on every row and every
  denial, impact preview on role edits (engine run twice, diff rendered).
  Write `dev/docs/best_practices/access-surface.md` as part of the change.
- **E3 registry-derived UI.** API-key category picker, PermissionSelector,
  PermissionViewer all read the registry (gateway + governance resources
  finally author-able); delete `permissionsConfig.ts` and
  `permission-categories.ts`.
- **E4 offboarding verb.** `grants.offboard` with
  preview/delete/revoke/cancel/bump/prove/report exactly as §10 of the
  ADR; Access UI flow; SCIM deprovision rewired to call it; the proof
  (`effectivePermissions == ∅`) asserted in an integration test with the
  full fixture (bindings at three scopes, two groups, three keys).
- **E5 delete.** `rbac.ts` (demo + ops resolution move into
  `server/authz/`), `role-binding-resolver.ts`, `batchScopePermissions`,
  the legacy reverse-shadow, the `TeamUser` table (migration), ADR-001 →
  "Superseded by ADR-092", README index updated, docs sweep.

**Gate E:** monolith gone (the file literally deleted); client bundle no
longer contains role bags (size check in CI); the matrix doc is the only
place the vocabulary is listed; spec scenarios for Part I all pass.

## Stage F - accelerate (epochs, cache, passports, witnesses)

- **F1 epochs + L1 cache.** `Organization.authzEpoch` int bumped inside
  every `grants.*` transaction, fanned out on Redis pub/sub; in-process
  LRU (principal+org → per-scope bitsets) validated by epoch, behind
  `AUTHZ_EPOCH_CACHE`; shadow-compare (cached vs fresh collect, sampled 1%)
  for one week. Metrics: `authz_cache_hit_ratio`, `authz_epoch_lag_seconds`.
- **F2 passports.** HMAC-signed blob `{principal, scope→bitmap, epoch,
  exp ≤60s}`; adopt on the collector path first (highest QPS), then the
  gateway resolve-key exchange, then ADR-057's share links (PR #5809).
- **F3 witness types.** `Authorized<"project">` brand returned by
  `authz.authorize`; new app-layer repositories take witnesses instead of raw
  ids; lint rule flags raw-id signatures in new repository files; no mass
  migration of existing repositories (module-by-module, opportunistic).
- **F4 latency proof.** Bench + prod histograms against the ADR §12 budget
  table (cache hit < 1 µs, miss 1-5 ms, revocation lag p99 < 1 s). Publish
  the measured table back into the ADR as an amendment.

**Gate F:** budget table confirmed by measurement; cache shadow silent;
revocation-lag SLO green for a week.

## Cross-cutting

- **Security regression pack** (lands with A, grows every stage): the 22
  confirmed findings from `dev/docs/security/hono-api-rbac-audit.md` as
  tests, plus Context #10's escalations (lite-member key, zero-binding
  service key, model-defaults ceiling inversion, teams-REST scope
  mismatch).
- **Observability:** `langwatch:authz` logger; decision audit stream (all
  denies, sampled allows); the four metrics named above; gcx dashboards
  built at each stage's start, not end.
- **Specs discipline:** every PR that changes behaviour cites its scenario
  in `specs/rbac/unified-authorization-engine.feature` and flips it off
  `@unimplemented` in the same diff.
- **Parallelism:** one person can run this serially in ~9-12 weeks; two
  people compress D and E to ~60% by fanning out route-family and page-area
  PRs. A, B, C stay serial (each rewires what the previous stage proved).

## Open decisions (blockers, with owners to assign)

| # | Decision | Blocks | Proposed default |
|---|----------|--------|------------------|
| D1 | ~~Union semantics sign-off~~ **settled** - implemented on this branch with bound scenarios; merging the engine PR is the sign-off, and the spec supersession note activates on ADR-092 acceptance | nothing | Union, per ADR §3 |
| D2 | ~~Legacy-key sunset date + comms owner~~ **settled 2026-08-17: there is no sunset.** Legacy keys are supported indefinitely; C3 becomes a compatibility backfill (see below), not a deprecation. No date, no comms doc, no `AUTHZ_LEGACY_KEY_ENFORCE` | nothing | n/a - decision was "don't" |
| D3 | ~~Empty-custom-role semantics change~~ **settled 2026-08-17: the role means what it says (deny).** Measured against production the same day: of 464 custom roles, zero are empty and zero carry only strings outside the registry, so the change lands with no affected customer and needs no remediation path | nothing | Deny, as proposed |
| D4 | Epoch storage (PG column + Redis fanout vs Redis-only) | F1 | PG column, Redis fanout |
| D5 | Access-surface IA (replace 5 pages vs add 6th) | E2 | Replace, with redirects |
| D6 | Passport secret (reuse CREDENTIALS_SECRET vs dedicated) | F2 | Dedicated `AUTHZ_PASSPORT_SECRET` |

## Where delivery stands (2026-08-12)

Shipped on this branch (`feat/adr-092-unified-authz`, rebased onto main after
the platform/app move):

- **The engine is two workspace packages plus app adapters, in the
  app-layer service/repository idiom.** `@langwatch/authz`
  (`packages/authz`): the vocabulary and the pure `AuthzEngine`, plus
  witness/bitset/`PassportService` - Prisma-free, env-free, browser-safe
  barrel. `@langwatch/authz-server` (`packages/authz-server`): the service
  classes (`AuthzCollectorService`, `AuthzService` with the epoch cache
  inside, `GrantsService`, `AuthzShadowService`) written against two
  repository INTERFACES - no storage engine in the package. The app keeps
  the Prisma repository implementations
  (`src/server/authz/repositories/*.prisma.repository.ts`), the redis epoch
  store, the tRPC middleware, and the composition root
  (`src/server/authz/runtime.ts`). Both package suites are wired into app
  CI. `require_()` is renamed `authorize()`.
- **Stage A engine-side, all but the last shadow seams.** Registry (126
  permissions, append-only bitset order), roles as differences with the
  cell-for-cell parity suite, collector, the pure `decide()` walk with every
  legacy quirk tagged `LEGACY-QUIRK(<stage>)`, shadow mode wired into the
  three tRPC resolvers and both legs of the api-key path behind
  `AUTHZ_V2_SHADOW`. Two known divergence families classified
  (`external-cap`, `ceiling-legacy-fallback`).
  The review round closed the last shadow seams: `batchScopePermissions`
  and `resolveProjectPermissionAny` are wrapped, and the demo-project
  early-return now fires the comparison before returning. `checkMany` is
  absent on purpose - it is a D2 deliverable, not an A3 one, because
  nothing calls it until the batch sites are codemodded, and an unused
  batch API would be a shape guessed rather than measured.
- **A5 resource tier, live against ShareLink.** Resource scopes, child
  closure, seven audiences, anonymous principal, token possession preserved.
- **D0 / F primitives seeded.** `GrantsService` (attach / update / revoke /
  replace / offboard-with-proof), epoch bump + L1 cache behind
  `AUTHZ_EPOCH_CACHE`, HMAC passports + bitsets, witnesses,
  `.permission()` on tRPC, `useCan` / `RequireCan`, the `authz` router.
- **Verification:** the package suites (`@langwatch/authz`,
  `@langwatch/authz-server`) plus the app-side authz/rbac suites; counts
  drift, the CI shard is the referee. Scoped tsgo clean on every touched
  file, Biome delta gate at zero added (four removed).

Not in this branch, deliberately: enforcement flips (`AUTHZ_V2_ENFORCE`),
any backfill, UI beyond the hooks, and the legacy-path deletions - those are
the stages below, each gated on the shadow soak.

## Data migration runbook (what actually has to move)

Every step follows the same shape: **expand → dual-run → verify → cut over →
delete**, one flag per cutover, rollback = flip the flag back (no step
destroys legacy data before its gate passes).

| # | Stage | Data | Mechanism | Gate before cutover | Rollback |
|---|-------|------|-----------|--------------------|----------|
| M1 | B | `TeamUser` rows → `RoleBinding` at TEAM scope | **In-place**: the `@langwatch/system-migrations` runner drives `TeamUserBackfillMigration` per organization at worker boot (role → role, `assignedRoleId` → `customRoleId`; personal teams stay team-scoped), audit-tagged `source: backfill-b`, one epoch bump per org. The old dry-run flag became the mandatory verify phase of the state machine | Per-org `decide()` parity sweep (with vs without legacy rows, spec: "Legacy membership rows resolve identically"); zero diffs → `finalized` and that org's fallback gate closes; any diff → held as `migrated`, behaviour unchanged | Write `rolled_back` on the org's state row (fallback reads resume fleet-wide within 15 min, no restart; the runner refuses to re-run that org, so it stays rolled back). Bindings stay (additive) |
| M2 | B | Delete `LEGACY-QUIRK(B)` fallbacks | Code deletion PR once M1's gate holds | Zero `legacy-team-fallback` grants observed in decision audit for 7 days | Revert PR |
| M3 | C | Legacy API keys (`permissions` JSON, no bindings) → explicit key bindings | Backfill mints bindings equal to each key's measured effective set, plus read-through minting for any key the backfill missed. No enforcement flag - D2 removed the sunset, so the raw-JSON path is retired by having no callers left, not by being switched off | Key-by-key parity report; canary orgs first. NOT gated on legacy use reaching zero - keys are supported indefinitely | Bindings stay (additive); a key that loses its bindings still mints them on next use |
| M4 | C | EXTERNAL org rows → `lite-member` role bindings; org-scoped enum semantics re-keyed | Same expand/verify shape; the escalation regression pack pins the fixed behaviour | Escalation pack green + shadow silent on the divergence families | Flag back |
| M5 | C5 | `ShareLink` → general `ResourceGrant` store | Prisma migration EXTENDS ShareLink: `permission` column (default `traces:view`), principal-audience columns; `resolveForViewer` delegates its authorization step to `authz.check` on the resource scope | Share e2e pack green; `sharedTrace.get` behaviour byte-identical for existing links | Revert the delegation; columns are additive |
| M6 | E | Legacy vocabulary types/bags in `rbac.ts` | Migrate-consumers-then-delete, in one stage: the registry becomes the source, every consumer is updated to import it directly, and `rbac.ts` is deleted. No re-export shim - the house rule bans re-exporting "for backwards compatibility", and a shim would leave two importable spellings of one vocabulary for a release, which is the drift this ADR exists to end | tsgo clean repo-wide + zero runtime references (grep gate in CI) | Revert the consumer-migration PR (it is one mechanical diff; `rbac.ts` comes back with it) |
| M7 | F | Epoch discipline | BEFORE `AUTHZ_EPOCH_CACHE` ever ships on: every RoleBinding/TeamUser/group/key write path must bump the org epoch. D0 routes the eight write paths through `grants.*`; until the last one is routed, the cache flag stays off (a legacy write that skips the bump would serve stale grants - fail-open) | All grant writes emit `authz.grants.*` audit actions (log-based check) | Flag off; collector reads live |

The order is load-bearing: M1-M2 before M3 (key ceilings consult the owner's
bindings), M5 independent (can land any time after A5), M6 last of the
schema-adjacent steps, M7's flag only after D0 completes.

## What lands next (in order)

1. ~~Shadow soak~~ - running: `AUTHZ_V2_SHADOW=1` on cloud web since
   langwatch-saas#1078 (2026-08-16).
2. ~~Stage-B PR~~ - the in-place runner + M1 rider + per-org fallback gate
   + ops surface (this amendment's PR). Cloud rollout = widen
   `SYSTEM_MIGRATIONS_COHORT` self-service-first, watching the ops page.
3. Stage-C PR (one PR): `roleKey` re-key + lite-member + legacy-key
   compatibility backfill (M3) + ShareLink `permission` column (M5) + spec
   truth-up. **Sign-offs D2/D3 both closed 2026-08-17 - this is unblocked.**
4. Separately and not blocking C: **the shadow soak currently produces no
   readable evidence.** The comparison emits nothing on agreement, and its
   failure path logs at `debug` (`authz-shadow.service.ts:193, 292, 372`)
   while cloud runs `PINO_LOG_LEVEL=info` - so a shadow throwing on every
   call is indistinguishable from perfect agreement, which is exactly what
   the logs show today (zero mismatches over the full live window since
   2026-08-16T23:51Z). The `authz_shadow_mismatch_total` metric gate A
   named was never implemented, so there is no dashboard and no
   denominator. Before gate A's seven days can mean anything: raise the
   failure log to `warn` (sampled), add a comparison counter alongside the
   mismatch counter so agreement is positively observable, and build the
   gcx dashboard. Small PR, but every day it waits is a wasted soak day.
5. Stage-D PR (one PR): `.permission()` codemod, eight write paths through
   `grants.*`, Hono edge identity, service principals. `AUTHZ_V2_ENFORCE`
   flips after merge, per cohort. (The annotations slice already merged as
   the scope-contract reference.)
6. Stage-E PR, then stage-F PR, per the one-PR-per-stage structure above.
