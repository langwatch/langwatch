# ADR-092 delivery plan — the grants ledger

**Companion to:** `dev/docs/adr/092-unified-authorization-engine.md` (the decision
model: the walk, union semantics, possession, the owner ceiling — all still in
force) and a **new ADR to be written** covering the storage and rollout redesign
below (number to be chosen after checking open PRs for collisions, not from main
alone).
**Spec:** `specs/rbac/unified-authorization-engine.feature`,
`specs/rbac/in-place-authz-migration.feature` (both still the behavioural
contract; new ledger scenarios to be added).
**This document:** the final consolidated plan, dated 2026-08-17. It replaces
the stage-by-stage (A–F) rollout entirely. The stages survive only as names for
work already merged (A = the engine #6894, B = the self-migration #7079).

## Decisions log (all 2026-08-17, Alex)

| # | Decision |
|---|---|
| 1 | **No legacy-API-key sunset.** Old keys work indefinitely; C3 became a compatibility backfill + read-through minting. `AUTHZ_LEGACY_KEY_ENFORCE` retired unshipped. |
| 2 | **Empty custom role = deny.** Measured in prod: 464 custom roles, zero empty, zero with only unregistered permission strings. No remediation path needed. |
| 3 | **Vocabulary: permission = the what, scope = the where — everywhere.** Never call permissions "scopes" (collides with ScopeChipPicker's customer-facing meaning). The reductive behaviour on keys is the *owner ceiling*, which already has a name. |
| 4 | **Build dark → per-org cutover → contract.** All code ships to production gated closed; an org cuts over all at once (never half); every deletion waits for 100 % of tenants finalized. |
| 5 | **The fork replaces the codemod.** Ten call sites (7 in `rbac.ts`, 3 in `role-binding-resolver.ts`) already carry every legacy decision and already call `authzShadowFor`. They become a per-org fork: engine decides for a cut-over org, legacy for everyone else, the other runs as shadow either way. The `.permission()` codemod is cosmetic cleanup in the contract PR. |
| 6 | **Grants are event-sourced** on the existing framework (ADR-049 shape). ClickHouse `event_log` is the single source of truth; the append is **waited on** for both disciplines; authz checks **never read ClickHouse** — Postgres projections only. |
| 7 | **Two dispatch disciplines**, declared per command: `queued` (append → GroupQueue → projection; the default) and `immediate` (append → inline apply on the calling path, Redis never involved; for revoke/offboard). Both are commands producing events; the discipline is transport, not semantics. Distinct from circuit-breaker *degradation* (a queued command falling back when Redis is sick — that idea comes from the identity programme's D02, but our work lands first and depends on nothing in that PR; the framework's in-memory processor already exists on main). |
| 8 | **Migration uses normal events.** The backfill emits plain `grant_attached` with `source: "backfill-b"` and `occurredAt` carried from the legacy row's `createdAt` (business time survives); `acceptedAt` is ledger time. One reducer path; replay exercises the live code. Only *process* facts get their own events: `migration_parity_proved`, `cutover_completed`, `cutover_rolled_back`. |
| 9 | **Batched appends.** Migration events append in chunks per org (producer-append-coalescing already exists as a framework concept); efficiency comes from batching appends, not from fattening events. |
| 10 | **`Grant` and `Role` are born as new, clean tables in PR 1** — never a rename of a live table, never hybrid columns on `RoleBinding`. During the transition the ledger is the single writer with two projections: events project into `Grant`/`Role` (the future) AND into legacy-shaped `RoleBinding`/`CustomRole` rows (the compat view the legacy path keeps reading). Contract deletes the compat projection and the old tables. Alex's mandate, stated 2026-08-17: this is the last rewrite of this flow — correct over expedient, everywhere the two diverge. |
| 11 | **Collectives as principals.** WHO ∈ user, apiKey, group, team, organization (+ project and anyone at the resource tier only). The org-role-floor quirk becomes a stored row: `Grant { who: members-of(org O), role: member, scope: ORG O }`, minted at cutover. Orgs gain the ability to change their own baseline. |
| 12 | **One `Grant` table across all five scope types** (ORGANIZATION, TEAM, PROJECT, RESOURCE, PLATFORM), absorbing ShareLink's role as the resource-grant store (token kept, possession preserved) and `ADMIN_EMAILS` as the platform-scope authority. A partial index keeps RESOURCE rows off the collector's principal-scan hot path. |
| 13 | **Platform grants minted from `ADMIN_EMAILS` by the cutover migration itself** — not manual insertion, because self-hosted operators never run anything (the in-place doctrine). The env var becomes bootstrap input, not live authority. |
| 14 | **The projection cursor replaces `Organization.authzEpoch`.** The cursor is a monotonic per-org version written by the thing that writes the data, so it cannot drift. M7 is deleted from the runbook; stage-F passports key on the cursor. |
| 15 | **Facts, not inference.** Every access is an explicit grant row; the four `LEGACY-QUIRK(C)` branches in `matchers.ts`/`walk.ts` exist because access is inferred today, and they die because it stops being. |

## The final data structure

### Postgres (projections — what every check reads)

```text
Grant                              -- NEW table, born in PR 1; RoleBinding
                                   -- becomes a derived compat projection
  id                deterministic from event content (idempotent upserts)
  organizationId    tenant on every row
  principalType     user | api_key | group | team | organization
                    | project | anyone          -- last two: resource tier only
  principalId       null for anyone
  roleKey           admin | member | viewer | lite-member | custom:<id>
  scopeType         ORGANIZATION | TEAM | PROJECT | RESOURCE | PLATFORM
  scopeId
  -- resource-tier columns (null elsewhere):
  token             possession secret (ShareLink heritage, ADR-057 intact)
  permission        the single permission a resource grant carries
  expiresAt, maxViews, viewCount
  createdAt, updatedAt
  -- partial unique indexes = idempotency; partial index excluding
  -- RESOURCE rows = the collector's principal-scan hot path

Role                               -- NEW table, born in PR 1; CustomRole
                                   -- becomes a derived compat projection
  id, organizationId, name, description
  permissions       registry strings only (empty = grants nothing, decision 2)
  kind              custom | system_api_key

AuthzProjectionCursor              -- one row per organization
  organizationId    pk
  lastEventId, acceptedAt          -- the cursor pair (house pattern)
  occurredAt, projectionVersion

AuthzCutoverProjection             -- projected from cutover_* process events;
  organizationId    pk             -- the fork and the legacy-fallback gate
  onEngine          bool           -- read THIS (successor of the stage-B
  provedAt, parityDiffs            -- migration-state read)

OrganizationUser                   -- membership only, never permission;
                                   -- role column becomes billing/seat data

GONE at contract: TeamUser · RoleBinding/CustomRole names · rbac.ts ·
role-binding-resolver.ts · the four LEGACY-QUIRK(C) branches · the fork and
the gate themselves · Organization.authzEpoch (never shipped)
```

### ClickHouse (the event log — source of truth, never on the read path)

Aggregate `authz_grants`, `aggregateId = organizationId` (the `billing_report`
precedent), events `lw.authz_grants.*`, calendar-versioned:

```text
runtime family (one fact each; source: grants-service | scim | invite |
                backfill-b | read-through-mint | ...):
  grant_attached      { grantId, principal, roleKey, scope, actor, source }
  grant_role_changed  { grantId, from, to, actor }
  grant_revoked       { grantId, actor, reason }
  role_defined / role_permissions_changed / role_deleted
  member_offboarded   { userId, revokedGrantIds[], proof }

process family:
  migration_parity_proved   { diffs[] }        -- empty = clean
  cutover_completed         { actor }
  cutover_rolled_back       { actor, reason }
```

`occurredAt` = business time (backfilled grants carry the legacy row's
`createdAt`); `acceptedAt` = ledger time. Appends are batched per org.

### The dispatch disciplines

```text
                    ┌─ ClickHouse append — WAITED, both paths ─┐
 queued (default):  └► GroupQueue (org FIFO) ► reducer ► PG    │ CH down ⇒ no
 immediate:         └► inline apply ► PG, then queue fan-out   │ grant writes;
                       (cursor guard makes double-apply no-op) │ checks unaffected
 Redis down: queued stalls & drains · immediate DOESN'T NOTICE
```

`immediate` needs a scoped ADR-007 amendment (inline processing in the web
role, this pipeline only, volume argument: grant writes per day, not traces
per second). Written by us; no dependency on the identity PR.

## The PR map (4 + 1)

### PR 1 — same position, event-sourced

Everything stage B shipped keeps working identically; the implementation
becomes the ledger. Bill of materials:

- `authz_grants` aggregate + all event schemas (runtime family defined, not
  yet emitted by production writers) + pipeline registration; pure reducer in
  `@langwatch/authz-server`, composition in the app.
- **The `Grant` and `Role` tables, born new and clean**, plus the two-headed
  projection: every event lands in `Grant`/`Role` (roleKey native, full WHO
  enum, five scope types from day one) AND in legacy-shaped
  `RoleBinding`/`CustomRole` rows (the compat view; the mapping
  roleKey → `(role, customRoleId)` lives only here). One writer, two views —
  never a dual-write from application code.
- The `immediate` discipline as a framework primitive + the ADR-007 amendment.
- `AuthzProjectionCursor`.
- `TeamUserBackfillMigration` refactored: emits batched `grant_attached`
  (source backfill-b, backdated occurredAt) → awaits projection → parity proof
  (unchanged: collect once, decide twice, against the compat view the engine
  reads today) → `migration_parity_proved`.
- Runner lifecycle transitions become events; `SystemMigrationTenantState`
  becomes their projection (same table, same latch, same ops page, same
  legacy-fallback-gate reads). Runner package stays generic — emitting events
  is the authz migration's behaviour, not the runner's.
- Shadow instrumentation folded in: failure log debug → warn, comparison +
  mismatch counters, gcx dashboard. (Today a shadow throwing on every call is
  indistinguishable from perfect agreement: zero mismatch lines since
  2026-08-16T23:51Z proves nothing without a denominator.)
- **Definition of done: the replay test** — replaying an org's stream produces
  byte-identical rows to the imperative M1 writer, and
  `in-place-authz-migration.feature` passes unchanged.

### PR 2 — the ledger becomes the only writer (still dark)

- **The genesis import**: a system migration emits events for every existing
  `RoleBinding`, `CustomRole`, and `OrganizationUser`-floor fact — per org,
  batched, `occurredAt` backdated to each row's `createdAt`, source
  `genesis-import` — so the entire grants state is event-derived from the
  beginning of history and replayable from genesis. Idempotent by
  deterministic event identity; proof = compat projection byte-equals the
  original rows.
- All eight write paths (member add, invites, SCIM, groups, API keys, project
  creation, role editor, better-auth hooks) become `grants.*` command
  emitters and **stop writing tables directly** — both tables are
  projection-fed from here on. `grants.revoke` / `offboard` are `immediate`.
- Read-through minting for legacy API keys (decision 1) — emits events like
  every other writer.
- REST error-code reconciliation (409 `role_binding_already_exists` vs
  GrantsService's 400) — before the write paths move, not after.

### PR 3 — the cutover machine + the fork live

- The composite per-org migration: import remaining facts (EXTERNAL →
  lite-member rows, legacy keys → grants, org-member floor row, that org's
  share links → RESOURCE grants, platform grants from ADMIN_EMAILS) → parity
  proof over every registry permission → `cutover_completed` →
  `AuthzCutoverProjection.onEngine = true`. ShareService writes become
  commands here too, so a cut-over org's whole surface is ledger-fed.
- The fork at the 10 seams reads the cutover projection: engine primary for
  migrated orgs, legacy as reverse-shadow; unmigrated orgs unchanged, legacy
  primary, engine as shadow.
- Rollback: `cutover_rolled_back` (immediate discipline), org back on legacy
  within the gate's cache TTL, no deploy.
- **Our own org first, in production, used end to end. Then widen the cohort
  self-service-first, watching the ops page.**
- effectivePermissions / useCan / Access-surface reads can ride here or trail
  as a small follow-up — they are per-org gated like everything else.

### PR 4 — the contract (only at 100 % finalized)

- `.permission()` codemod (~380 sites, now cosmetic), Hono edge identity.
- Delete: `rbac.ts`, `role-binding-resolver.ts`, the four quirk branches,
  the compat projection and the `RoleBinding`/`CustomRole`/`TeamUser` tables
  themselves, the fork, the gate. No renames — `Grant` and `Role` were born
  with their names in PR 1.
- The client role-bag imports and the 55 raw role comparisons go with the
  deletions (bundle-size check in CI).
- ADR-001 → superseded; docs sweep; spec truth-up
  (`scoped-role-bindings.feature` → union semantics).

### PR 5 — accelerate (independent, whenever)

Passports keyed on the projection cursor (`AUTHZ_PASSPORT_SECRET`, D6), L1
cache validated by cursor (M7 is gone — the cursor cannot be skipped by a
write, because the write is what advances it), edge revocation via short-TTL
passports. Nothing above waits on this.

## Migration safety

### Pre-flight facts (run against prod before an org cohort widens)

| Check | Status |
|---|---|
| Empty custom roles | ✅ 0 of 464 (measured 2026-08-17) |
| Roles with only unregistered permission strings | ✅ 0 (measured 2026-08-17) |
| `jsonb_typeof(permissions)` shape sweep (non-array rows) | ⏳ query written, result pending |
| Grants referencing deleted custom roles (poisoned bindings) | ⏳ |
| TeamUser rows referencing deleted users/teams | ⏳ |
| Same user+team disagreeing between TeamUser and binding | ⏳ (parity would catch; pre-flight sizes it) |
| Orgs leaning on the org-level union quirk (expected `held` cohort) | ⏳ sizeable; held is the designed steady state until remediation |
| Legacy keys with no bindings / zero-binding service keys | ⏳ |

The universal guard stays the per-org parity proof: collect once, decide
twice over every registry permission; any diff holds the org (behaviour
unchanged, diffs in the report, re-proved every pass). `held` is not failure.

### Testing doctrine (Alex, verbatim intent)

Real integration tests on real containers — Postgres, Redis, ClickHouse —
one scenario per failure mode, each bound to a spec scenario with
`@integration` + `@scenario`; no datastore mocks, no journey soup, no
overtesting:

1. queued write converges to the projection (cursor advances once).
2. **immediate revoke: Grant row gone before the call returns, with Redis
   stopped.**
3. crash mid-import: next pass finishes the stranded work (the `previous`
   contract).
4. replay determinism: byte-identical rows vs the imperative writer.
5. `rolled_back` pin: runner refuses the org; gate restores legacy inside
   the TTL.
6. quirk org: parity fails honestly → held; explicit org-scope grant → next
   pass finalizes.

(Local note: this environment lacks `LANGWATCH_TEST_*` URLs, so the
datastore lane needs them set or runs in CI; never `CI=1` locally.)

## What survives from ADR-092 untouched

Registry (126 permissions, append-only bitset order) · roles as diffs ·
the walk COLLECT→FILTER→EXPAND→UNION→DECIDE→RECORD · additive union ·
possession-not-existence (ADR-057) · owner ceiling · witnesses · denial
reasons · the error codes (`permission_denied` etc.) · the terms bible plus
its 2026-08-17 permission-vs-scope ruling.

## Next actions

1. Write the new ADR (number checked against open PRs first) — the grants
   ledger, disciplines, vocabulary, rollout doctrine; supersedes ADR-092's
   storage/rollout sections by explicit reference.
2. New spec scenarios: immediate revocation, collective grants, floor-as-row,
   cutover/rollback (`specs/rbac/`).
3. PR 1.
