# ADR-092 delivery plan — the grants ledger

**Companion to:** `dev/docs/adr/092-unified-authorization-engine.md` (the decision
model: the walk, union semantics, possession, the owner ceiling — all still in
force). **No new ADR**: ADR-092's storage and rollout sections are rewritten in
place to the design below, and ADR-007 gains a scoped amendment section for the
`immediate` discipline (the ADR-004 "Amendment: In-process workers" precedent).
ADR-001 flips to Superseded at contract. If genuinely new ground ever wants its
own number, rebase off origin/main and take the next one — nothing more.
Related ADRs the rewrite must cite: ADR-021 (the `(scopeType, scopeId)` house
shape, and its warning that org-scoped models lack the tenancy guard — the new
`Grant` table joins the guard regime), ADR-015 (the replay protocol the
byte-identical test rides), ADR-098 (subscriber vocabulary; subscribers are
excluded from replay), ADR-022 *event_log as single source of truth* (cite by
title — two files share the number; note `leanForProjection` conformance is a
no-op here, no heavy fields), ADR-093 (Redis as an owned client).
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
| 16 | **ADRs are revised in place, not superseded by new numbers.** ADR-092's storage/rollout sections get rewritten; ADR-007 gains a scoped amendment; ADR-001 → Superseded at contract. New numbers only for genuinely new ground, taken after rebasing off origin/main. |
| 17 | **The audit log is an insert-only event subscriber**, not a projection. Each runtime grant event inserts one `AuditLog` row in the existing shape — row id derived from the event id, `ON CONFLICT DO NOTHING`, never an update. A `when` guard skips `genesis-import` / `backfill-b` / `read-through-mint` sources so cutover never floods the audit page with backdated history. Subscribers are excluded from replay (ADR-098), so rebuilds can't touch it either. Grant write paths stop writing `AuditLog` directly when they become command emitters. The audit UI, table, and retention are untouched. |
| 18 | **SCIM is a reconciler.** IdP pushes are declarative state; the handler diffs desired state against the Postgres projection and emits only the difference as `grants.*` commands (`source: "scim"`) — idempotent by construction, replayed pushes diff to nothing (the same diff-and-emit shape as the genesis import). SCIM **removals ride `immediate`** (an IdP deprovision is the fired-employee case); additions are queued. `scim-group-mapping.feature` is rewritten storage-neutral once, so it is true before and after cutover. |
| 19 | **The epoch stays until contract.** The Redis authz epoch store (`server/authz/epoch.ts`) is live, cheap, and spec-bound (`in-place-authz-migration.feature:112`, bound at `team-user-backfill.unit.test.ts:179`) — PR 1 keeps bumping it alongside the new cursor, which is what makes "passes unchanged" honestly true. The epoch dies in the contract PR, where its two spec scenarios are truthed-up to the cursor. (The `Organization.authzEpoch` *column* never shipped; the Redis store did.) |
| 20 | **Per-user legacy ADMIN facts are in the import inventory.** `OrganizationUser.role = ADMIN` with zero bindings is a live fallback path (`specs/ai-gateway/rbac-legacy-admin-fallback.feature`); the floor row covers members only. The genesis import mints an org-scoped admin grant per such user, `occurredAt` from the row's `createdAt`. |
| 21 | **Public REST names are frozen.** `/role-bindings`, the `bindings` wire shape, and `role_binding_already_exists` (409, `role-bindings-rest-api.feature:92`) are customer contracts — the no-sunset philosophy applies to API names exactly as to old keys. The Grant/Role rename never leaks to the wire; no `/grants` API until a customer need exists. |

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
the gate themselves · the Redis authz epoch store (bumped as today through
PR 1-3, superseded by the cursor at contract — decision 19)
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
  reads today) → `migration_parity_proved`. The Redis epoch bump stays exactly
  as today (decision 19) — the cursor is added alongside, not instead.
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
  `RoleBinding`, `CustomRole`, and `OrganizationUser` fact — the member floor
  row AND a per-user org-scoped admin grant for every zero-binding
  `OrganizationUser.role = ADMIN` (decision 20) — per org, batched,
  `occurredAt` backdated to each row's `createdAt`, source `genesis-import` —
  so the entire grants state is event-derived from the beginning of history
  and replayable from genesis. Idempotent by deterministic event identity;
  proof = compat projection byte-equals the original rows.
- All eight write paths (member add, invites, SCIM, groups, API keys, project
  creation, role editor, better-auth hooks) become `grants.*` command
  emitters and **stop writing tables directly** — both tables are
  projection-fed from here on. `grants.revoke` / `offboard` are `immediate`.
  SCIM specifically becomes a reconciler (decision 18): diff desired IdP state
  against the projection, emit only the difference; removals `immediate`.
- **The audit subscriber** (decision 17) lands here, in the same change that
  stops the write paths writing `AuditLog` directly: insert-only, row id from
  event id, `ON CONFLICT DO NOTHING`, `when` guard skipping genesis/backfill/
  mint sources.
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
- The Redis epoch store goes too (decision 19); its two spec scenarios
  (`in-place-authz-migration.feature:112`, `:127`) are truthed-up to the
  cursor in the same change.
- Public REST names stay (decision 21) — the deletion is internal only.
- ADR-001 → superseded; docs sweep; spec truth-up
  (`scoped-role-bindings.feature` → union semantics; stale stage-C4 pointers
  in both rbac spec headers; `sharing.feature`'s ADR pointer is 057, not 039).

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

1. Rewrite ADR-092's storage and rollout sections in place (decision 16):
   the ledger, both disciplines, the subscriber, the doctrines nothing else
   backs (no-transactions/idempotency, occurredAt/acceptedAt, deterministic
   event-derived ids, batched appends), and the related-ADR cross-links
   (021, 015, 098, 022 *event_log*, 093). Add the ADR-007 amendment section.
2. Spec pass: **extend three bound scenarios** rather than duplicate them —
   `unified-authorization-engine.feature:242` gains the transport guarantee
   (Grant row gone before the call returns, Redis stopped), `:340` gains the
   `member_offboarded` event proof, `:107` already covers the owner ceiling —
   and **add three genuinely new**: collective grants, floor-as-row, the
   cutover process events (extending `in-place-authz-migration.feature`'s
   rollback scenario, not a parallel file). Rewrite
   `scim-group-mapping.feature` storage-neutral (decision 18).
3. PR 1.
