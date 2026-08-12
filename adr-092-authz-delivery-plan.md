# ADR-092 delivery plan - unified authorization engine, end to end

**Companion to:** `dev/docs/adr/092-unified-authorization-engine.md` (the what and why)
**Spec:** `specs/rbac/unified-authorization-engine.feature` (the behavioural contract)
**This document:** the how - every stage sliced into PRs, with gates, flags,
rollback, and the open decisions that block each stage.

The ADR's six stages (A-F) survive here unchanged, with one addition: a stage
D0 (the `grants.*` write service) pulled forward because stages D, E, and F
all depend on it. Roughly 27 PRs, six flag-gated soak periods, and two
customer-facing behaviour changes that need product sign-off before their
stage starts.

## The shape of the whole thing

```
        A ENGINE           B BACKFILL         C RE-KEY           D ONE IDIOM
        registry+roles     TeamUser →         roleKey column     grants service,
        engine+shadow      bindings, kill     lite-member fix,   .permission(),
   ┌──► 4 PRs, 1 wk   ──►  fallbacks     ──►  legacy-key    ──►  edge identity,
   │    + 1 wk soak        3 PRs, 1 wk        sunset             authz.require
   │                                          4 PRs, 1.5 wk     8 PRs, 2-3 wk
 spec sign-off                                     │                  │
 (union semantics)                    product sign-off #1, #2         │
                                                                      ▼
        F ACCELERATE                            E DERIVE + DELETE
        epochs, L1 cache,                       useCan, Access surface,
        passports, witnesses   ◄──────────────  offboard verb, delete
        4 PRs, 1-2 wk                           rbac.ts monolith
                                                5 PRs, 2-3 wk

 Total: ~27 PRs · ~9-12 weeks wall clock (soaks dominate, code doesn't)
 Parallelism: D's route-family PRs fan out; E1/E3/E4 run parallel after D
```

Every stage ends at a **gate**: a measurable condition, not a vibe. No stage
starts until the previous gate is green, except where the dependency arrows
above say otherwise.

## Flags and kill switches

```
 AUTHZ_V2_SHADOW        stage A    run engine alongside legacy, log mismatches,
                                   never affect responses (sampled, default 100%
                                   in dev/staging, 10% cloud)
 AUTHZ_V2_ENFORCE       stage D    engine is primary, legacy runs as the shadow
                                   (reverse-shadow); 0 = instant revert to legacy
                                   until stage E deletes legacy entirely
 AUTHZ_LEGACY_KEY_ENFORCE  stage C log-only → enforce, per-org overridable for
                                   escalation during the sunset window
 AUTHZ_EPOCH_CACHE      stage F    L1 cache on/off; off = every check collects
                                   (stage-E behaviour, always correct)
```

Env flags, not PostHog flags - authz cannot depend on a third-party flag
service (ADR-005 flags are fine for UI reveals like the Access surface).

Rollback posture per stage: A is additive (delete the module). B and C keep
their source columns/tables until the following stage's gate passes, so
rollback is "re-enable fallback reads". D is `AUTHZ_V2_ENFORCE=0`. E is the
point of no return (legacy deleted) - it only starts after D has run enforced
and quiet for a week. F is `AUTHZ_EPOCH_CACHE=0`.

## Stage A - engine, registry, shadow (no behaviour change)

**Blocked on:** spec sign-off for union semantics (decision D1 below).

```
 A1  registry           A2  built-in roles      A3  engine            A4  shadow mode
 server/authz/          server/authz/roles.ts   server/authz/         wrap the 6 legacy
 registry.ts            viewer/member/admin/    engine.ts + explain   resolvers, compare,
 + matrix codegen       lite-member/demo/ops    + principals + scopes log mismatches
```

- **A1 `server/authz/registry.ts`.** All ~32 resources, per-resource actions,
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
- **A2 `server/authz/roles.ts`.** Built-ins declared as diffs (member =
  viewer + additions, admin = member + additions). *The load-bearing test:*
  generated exhaustive equality against today's bags in `rbac.ts` - every
  (role × permission) cell must match, hierarchy rules included. This is the
  characterisation suite the whole migration leans on.
- **A3 `server/authz/engine.ts`.** `Principal` (`{actor, subject}` pair),
  `ScopeRef`, COLLECT/FILTER/EXPAND/UNION/DECIDE/RECORD, `AuthzDecision`
  with `denialReason` + `audience`, `explain()`, `checkMany` (collect once),
  ceiling algebra (`∩`) for API keys. Pure core over a collected-bindings
  input; one Prisma-backed collector beside it.
  *Tests:* port `rbac.test.ts`, `rbac-integration.test.ts`,
  `role-binding-resolver.unit.test.ts` + integration to run against the
  engine unchanged. Property tests: adding a binding never removes access
  (union monotonicity); org-exclusive permissions never resolve from
  team/project bindings; EXTERNAL cap parity with today's tRPC path
  (deliberately keeping today's asymmetry until C2 fixes it - the shadow
  must match legacy, quirks and all, and each quirk gets a `// LEGACY-QUIRK`
  comment naming its removal stage).
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
- **A4 shadow mode.** Wrap `resolveProjectPermission`,
  `resolveTeamPermission`, `hasOrganizationPermission`,
  `checkRoleBindingPermission`, `resolveApiKeyPermission`,
  `batchScopePermissions` behind `AUTHZ_V2_SHADOW`: after the legacy answer
  returns, fire the engine async, compare, emit
  `authz_shadow_mismatch_total` (labels: caller, permission, scopeType,
  legacyAnswer) + a structured log with both walks. Never blocks, never
  changes a response.

**Gate A:** 7 consecutive days of zero unexplained mismatches in staging and
one cloud canary org. Every explained mismatch is either an engine fix or a
`LEGACY-QUIRK` entry. Mismatch dashboard built with gcx before the soak
starts, not after.

## Stage B - backfill, then delete the fallbacks

- **B1 backfill script** (idempotent, org-batched, dry-run first):
  `TeamUser` → TEAM-scoped binding carrying `(role, assignedRoleId →
  customRoleId)`. Personal teams keep their bindings team-scoped (parity
  with today's `isPersonal: false` exclusion in the org-level union -
  verified by the report, not assumed). `OrganizationUser` is NOT promoted
  to org bindings - today a bare `OrgUser.role=ADMIN` with no binding has no
  admin power (`rbac.ts:1050-1057`), and the backfill preserves today's
  semantics exactly. The script emits a per-user parity report:
  engine-with-fallbacks vs engine-bindings-only, and refuses to finalise any
  org with a diff.
- **B2 delete the fallback reads.** Both `rbac.ts` fallback branches, the
  batch legacy replay, and `virtualKey.authz.ts`'s membership set move to
  bindings. Add `findOrgAdmins()` (binding-aware) and migrate the six
  `where: { role: "ADMIN" }` readers (`usage-limit.service.ts`,
  `langyAttribution.ts`, `resolveOrgAdminEmail.ts`,
  `project.prisma.repository.ts`, `costs.ts`,
  `organization.prisma.repository.ts`).
- **B3 stop writing `TeamUser`** (invite/apply paths), schema comment marks
  it read-only-legacy. The table itself survives until Gate C passes
  (rollback = re-enable B2's reads).

**Gate B:** shadow still silent; backfill parity reports archived per org;
CI grep-gate asserts zero `teamUser.find*` outside the deprecated allowlist.

## Stage C - re-key roles, fix the principal escalations

**Blocked on:** product sign-off #1 (legacy-key sunset comms + date) and #2
(empty-custom-role semantics change). Both are called out in the ADR's
migration section as the only customer-visible changes.

- **C1 `RoleBinding.roleKey`.** Nullable column, backfilled from
  `(scopeType, role, customRoleId)` → `admin | member | viewer |
  lite-member | custom:<id>`; dual-read window; then NOT NULL and the
  org-scope enum special cases in the engine die (roles become fully
  data-driven).
- **C2 lite-member becomes a role.** EXTERNAL org members get
  `lite-member` at org scope during C1's backfill; SCIM provisioning maps
  seat → roleKey (member vs lite-member) instead of unconditional MEMBER
  (`scim.service.ts:153-204`); the API-key resolver's missing EXTERNAL cap
  (Context #10's escalation) closes by construction because keys and
  sessions now read the same roleKeys. Seat classification stays as billing
  data the engine never reads (coordinate with #3388's licence counting).
  *Regression tests:* lite member's key ≤ lite member's session, on every
  surface.
- **C3 legacy API key sunset.** Backfill every legacy key to explicit
  bindings mirroring today's full-project access; deprecation response
  header + `authz_legacy_key_use_total` metric; comms doc for cloud
  customers; `AUTHZ_LEGACY_KEY_ENFORCE` staged log-only → enforce. The
  zero-binding service-key default-to-org-ADMIN (`api-key.service.ts:151`)
  gets the same treatment: backfill explicit bindings for existing keys,
  then delete the default (creation requires bindings).
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
  not generated blind.
- **D3 Hono edge identity.** One middleware resolves any credential →
  `Principal`; `requirePermission`/`apiKeyPermission` strategies call the
  engine. The ~15 `handlerManagedAuth` blocks collapse, one PR per route
  family: (a) collector + otel, (b) legacy REST traces/annotations/
  evaluations, (c) playground/sse/generate, (d) langy, (e) exports +
  `pages/api/experiment/init.ts`. The REST-vs-tRPC action mismatches
  (`annotations:manage` vs `annotations:create`) get reconciled here,
  registry as referee - each divergence is a one-line decision in the PR.
- **D4 services + authz modules.** `PermissionsService` and the four
  `*.authz.ts` files become policy tables evaluated by `authz.require`;
  the `checkPermissionOrPubliclyShared` wrapper becomes
  `.orPublicResource()` on the six tRPC procedures + share routes
  (coordinate with the ADR-039 token-share PR #5809 - door 2 should accept
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
  gateway resolve-key exchange, then share links with #5809.
- **F3 witness types.** `Authorized<"project">` brand returned by
  `authz.require`; new app-layer repositories take witnesses instead of raw
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
| D1 | Union semantics sign-off (spec rewrite) | A | Union, per ADR §3 |
| D2 | Legacy-key sunset date + comms owner | C3 | 60-day window from C1 merge |
| D3 | Empty-custom-role semantics change | C1 | Role means what it says (deny) |
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
- **Stage A engine-side, complete.** Registry (126 permissions, append-only
  bitset order), roles as differences with the cell-for-cell parity suite,
  collector, the pure `decide()` walk with every legacy quirk tagged
  `LEGACY-QUIRK(<stage>)`, shadow mode wired into the three tRPC resolvers
  and both legs of the api-key path behind `AUTHZ_V2_SHADOW`. Two known
  divergence families classified (`external-cap`, `ceiling-legacy-fallback`).
- **A5 resource tier, live against ShareLink.** Resource scopes, child
  closure, seven audiences, anonymous principal, token possession preserved.
- **D0 / F primitives seeded.** `GrantsService` (attach / update / revoke /
  replace / offboard-with-proof), epoch bump + L1 cache behind
  `AUTHZ_EPOCH_CACHE`, HMAC passports + bitsets, witnesses,
  `.permission()` on tRPC, `useCan` / `RequireCan`, the `authz` router.
- **Verification:** 153 unit tests across authz + resolver suites, scoped
  tsgo clean on every touched file, Biome delta gate at zero added (four
  removed).

Not in this branch, deliberately: enforcement flips (`AUTHZ_V2_ENFORCE`),
any backfill, UI beyond the hooks, and the legacy-path deletions - those are
the stages below, each gated on the shadow soak.

## Data migration runbook (what actually has to move)

Every step follows the same shape: **expand → dual-run → verify → cut over →
delete**, one flag per cutover, rollback = flip the flag back (no step
destroys legacy data before its gate passes).

| # | Stage | Data | Mechanism | Gate before cutover | Rollback |
|---|-------|------|-----------|--------------------|----------|
| M1 | B | `TeamUser` rows → `RoleBinding` at TEAM scope | Idempotent backfill job (role → role, `assignedRoleId` → `customRoleId`; personal teams flagged, not skipped) writes bindings tagged `source: backfill-b` in the audit event | Per-user `decide()` parity sweep: effective permissions identical before/after for EVERY member (spec: "Legacy membership rows resolve identically") + 7 quiet shadow days | Delete rows the job tagged; fallback path still live |
| M2 | B | Delete `LEGACY-QUIRK(B)` fallbacks | Code deletion PR once M1's gate holds | Zero `legacy-team-fallback` grants observed in decision audit for 7 days | Revert PR |
| M3 | C | Legacy API keys (`permissions` JSON, no bindings) → explicit key bindings | Backfill mints bindings equal to each key's measured effective set; `AUTHZ_LEGACY_KEY_ENFORCE` flips the raw-JSON path off | Key-by-key parity report; sunset comms sent (D2); canary orgs first | Flag back on; bindings stay (additive) |
| M4 | C | EXTERNAL org rows → `lite-member` role bindings; org-scoped enum semantics re-keyed | Same expand/verify shape; the escalation regression pack pins the fixed behaviour | Escalation pack green + shadow silent on the divergence families | Flag back |
| M5 | C5 | `ShareLink` → general `ResourceGrant` store | Prisma migration EXTENDS ShareLink: `permission` column (default `traces:view`), principal-audience columns; `resolveForViewer` delegates its authorization step to `authz.check` on the resource scope | Share e2e pack green; `sharedTrace.get` behaviour byte-identical for existing links | Revert the delegation; columns are additive |
| M6 | E | Legacy vocabulary types/bags in `rbac.ts` | Derive-then-delete: registry becomes the one source, `rbac.ts` re-exports derived values for one release, then consumers import the registry | tsgo clean repo-wide + zero runtime references (grep gate in CI) | Restore re-exports |
| M7 | F | Epoch discipline | BEFORE `AUTHZ_EPOCH_CACHE` ever ships on: every RoleBinding/TeamUser/group/key write path must bump the org epoch. D0 routes the eight write paths through `grants.*`; until the last one is routed, the cache flag stays off (a legacy write that skips the bump would serve stale grants - fail-open) | All grant writes emit `authz.grants.*` audit actions (log-based check) | Flag off; collector reads live |

The order is load-bearing: M1-M2 before M3 (key ceilings consult the owner's
bindings), M5 independent (can land any time after A5), M6 last of the
schema-adjacent steps, M7's flag only after D0 completes.

## What lands next (in order)

1. Open D1-D3 as decision threads (they gate B and C - cheap to start now).
2. Shadow soak: enable `AUTHZ_V2_SHADOW=0.1` on staging, build the
   mismatch dashboard (gcx, `langwatch:authz:shadow` warns), start the
   7-day clock. The two knownDivergence families are expected lines.
3. Stage-D retrofit PR: flip representative routers to `.permission()` and
   route the first legacy write path through `grants.*` (member add), with
   `resolveForViewer` delegating to `authz.check` as the A5 proof.
4. M1 backfill job behind a dry-run flag, so the parity sweep can run
   against production data without writing anything.
