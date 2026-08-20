# ADR-101: A grant aggregate is a grant, not an organization

**Date:** 2026-08-20

**Status:** Proposed

## Context

ADR-092 §13 built the grants ledger as one aggregate per organization —
`aggregateType = "authz_grants"`, `aggregateId = organizationId` — citing the
`billing_report` precedent. That precedent does not carry: the
`reportUsageForMonth` handler returns `[]` on every path, so it never appends
an event. Its aggregate is a pure routing key and its fold state is
permanently empty, which is why the shape's one weakness never showed there.

Copied into a pipeline that *does* append, the shape means the fold state of a
single aggregate is every grant the organization has ever held. The state
store reconstructs that whole state from the compat tables on every
invocation:

```
PrismaAuthzGrantsProjectionRepository
  load()            -> prisma.grant.findMany({ where: { organizationId } })   unbounded
  readStoredHeads() -> prisma.grant.findMany({ where: { organizationId } })   unbounded, again
                       ... once per applied event batch
```

Measured on `HXECRq2mRfSQpxTiSCcsS` (2026-08-20, LangWatch's own organization):

| observation | value |
|---|---|
| grant rows on the aggregate | 69,826 |
| genesis facts landed 10:26 -> 16:22 | 326 |
| effective fold rate | ~0.015 facts/sec |
| rate the convergence budget assumes | ~1.8 facts/sec |
| cutover facts awaiting | ~69,500 |
| time those need at the assumed rate | ~10.7 hours |
| budget the ceiling actually grants | 20 minutes (`maxTimeoutMs`) |

The import therefore decelerates as it progresses — every batch re-reads a
head that the previous batch made larger — and the convergence wait can never
be satisfied, on any retry, by arithmetic rather than by any failure. Every
subsystem reports healthy throughout: commands `status="completed"` with zero
failures, the projection completing, no blocked queue groups, ~1.3s backlog.

Two distinct things share the aggregate today, and only one of them wants it:

| fact | cross-grant invariant? | volume on this org |
|---|---|---|
| roles, membership, cutover state | yes, genuinely organization-wide | tens |
| RESOURCE grants (share links) | none — ADR-057 dropped one-share-per-resource; the token is the credential's own identity | 69,500 |

An aggregate is a consistency boundary, and a consistency boundary is supposed
to be small and bounded. This one grows without limit for as long as the
organization exists.

A second, quieter problem: grant identity has two rules. The genesis import
*adopts* a legacy `RoleBinding` row id as the grant id, while organization
facts (the member floor row, the legacy-admin fallback) *derive* theirs with
`deriveGrantId`, because they have no legacy row to adopt from. One entity
type, two identity schemes, decided by provenance.

We are still in rollout. No organization is on the engine, the ledger is dark,
and every grant and event written so far is disposable.

## Decision

**We will separate the tenant from the aggregate.** The organization stays the
tenant — it is the isolation and routing boundary, it is what the ClickHouse
client resolver places, and it is what per-tenant ordering keys on. It stops
being the aggregate.

`authz_grants` is replaced by two aggregate types. The split follows the table
above: what has a genuine organization-wide invariant keeps the organization
boundary, and what does not gets its own.

```
                  tenantId = organizationId   (both: routing, isolation)
  ┌─────────────────────────────┬──────────────────────────────────────┐
  │ authz_grant                 │ authz_org_policy                     │
  ├─────────────────────────────┼──────────────────────────────────────┤
  │ id = grantId                │ id = organizationId                  │
  │ one grant's lifecycle:      │ role definitions, cutover flag,      │
  │ attached, role changed,     │ migration tenant state, epoch        │
  │ revoked                     │                                      │
  │ ~1-5 events, bounded        │ tens of events, bounded              │
  │ the unbounded part, now     │ the part that really is org-wide     │
  │ bounded per aggregate       │ (deleteRole, offboard sequencing)    │
  └─────────────────────────────┴──────────────────────────────────────┘
```

Roles stay on the organization aggregate rather than becoming a third type.
They are few (139 on the incident organization, one per API key), they change
rarely, and keeping them beside the cutover flag preserves the
role-before-grant ordering the import relies on without a cross-pipeline
dependency.

Because one command may no longer straddle several aggregates, the batched
`attachGrants` becomes a singular `attachGrant`. The import sends one command
per grant instead of one command per 500-grant chunk. That is more commands,
but each is tiny, and with the group key on the aggregate they run
concurrently rather than through one per-organization queue — which is the
point.

**The rule an aggregate id must satisfy is STABILITY ACROSS RETRIES of the
same fact, not determinism for its own sake.** The event log dedupes on

```sql
ENGINE = ReplacingMergeTree(EventTimestamp)
ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)
```

so `AggregateId` is part of the dedup key and an idempotency key only dedupes
*within* one aggregate. An id minted freshly per attempt therefore defeats
idempotency entirely: the retry lands on a different aggregate, nothing
collapses, and each pass adds another copy of the same fact. This is the
row-explosion failure mode relocated, not avoided.

Derivation is how a writer with no memory satisfies that rule. A migration
retries across processes and days with nowhere to record what it minted last
time, so the id must be recomputable from the fact — derivation is the
mapping, computed rather than stored, and the alternative is a
`legacyRowId -> grantId` table that is a worse cache of the same function. A
live write does have somewhere to remember: the caller mints `commandId` once
and reuses it on retry, so a KSUID minted alongside it is equally stable.

Both paths produce a `grant_`-prefixed KSUID and nothing downstream can tell
them apart. What follows is therefore about where the bits come from:

- **Every imported or backfilled grant derives its id from the fact.** A grant
  IS the relation (principal × scope × resource) at a business time, so its id
  is a function of that and nothing else. Adoption of legacy row ids is removed
  entirely: it was the second rule that made one entity type have two, decided
  by provenance rather than by anything about the grant.

  ```
  grantId = KSUID(
    prefix    "grant",
    timestamp floor(occurredAtMs / 1000),          // business time, k-sortable
    instance  sha256(preimage)[0..8),
    sequence  sha256(preimage).readUInt32BE(8),
  )
  preimage = [organizationId, principal.type, principal.id ?? "",
              scope.type, scope.id, resourceToken ?? ""].join("")
  ```

  This is the existing `deriveGrantId`, unchanged in construction. Restating a
  fact derives the same id, so the retry lands on the same aggregate with the
  same idempotency key and the engine collapses it. Uniqueness becomes a
  property of identity rather than of a lock held over a large aggregate.

- **A grant created by a live write may mint a KSUID instead**, because its
  caller already mints `commandId` once and reuses it on retry, which supplies
  the stability. Its business time is `now()`, so derivation would produce a
  unique id regardless and buys nothing. The requirement on this path is only
  that the id is minted ONCE per logical action and not re-minted per attempt.

- **An entity with mutable attributes gets a minted, stable id.** A role has a
  name and a permission list that both change, so deriving its identity from
  its content would make a rename a different role and strand every grant
  referencing `custom:<id>`. Roles adopt their `CustomRole` row id on import
  and mint a KSUID when created ledger-first. This is uniform for roles: every
  role gets a stable natural id, never a content hash.

**We will drop cross-aggregate work out of the fold.** `removeDepartedGrants`
and `removeDepartedRoles` delete rows the current fold's own events never
mention, which a per-aggregate fold cannot do and should never have done. A
fold writes only what its own events say. The deny direction — revoking a head
fact whose legacy row is gone — moves into the migration's reconciliation
pass, which reads the projection and sends explicit per-grant revoke commands.

**We will key the queue group on the aggregate, not the tenant**, so grants
belonging to one organization fold concurrently while events for a single
grant stay strictly ordered.

**We will not preserve backwards compatibility.** Every grant, role and event
written under the old scheme is deleted, and the rollout restarts from a clean
ledger with a new set of ids.

## Rationale / Trade-offs

Making the grant the aggregate is what bounds the fold. `load()` and the
head read become a lookup of one row by primary key, so cost per event stops
depending on how much the organization already holds, and the import stops
decelerating. It also removes the serialization: 69,500 share links import in
parallel rather than through a single per-organization queue.

The obvious objection is that some invariants really are organization-wide —
deleting a role must not strand grants that reference it, offboarding revokes
across the whole organization, and the deny sweep asserts that nothing exists
beyond the expected set. We accept eventual consistency for all three, because
none of them needs atomicity to be correct:

- A grant naming a role that no longer exists resolves to the empty permission
  list, which grants nothing. The unsafe direction is denied by construction.
- The deny sweep is a reconciliation over a read model. It is a query and a
  set of compensating commands, which is what it already was in substance.
- Offboarding fans out into one revoke command per grant.

Offboarding needs care, because the organization aggregate was carrying a
safety property that is easy to drop by accident. `offboardMember` documents
it: *"The fold sweeps by principal, so an incomplete list cannot leave the
member holding access."* A caller that missed a grant was still safe, because
the fold held the whole organization's state and swept it. Per-grant
aggregates have no organization-wide state to sweep, so that guarantee does
not survive the split on its own.

We keep it by moving the guarantee to where it was always strongest: the
synchronous projection write. ADR-092 decision 7 already sanctions exactly one
direct projection write for revocation, so that the deny holds before the call
returns even with the queue stopped. Offboarding uses it, sweeping by
principal against the projection, and the ledger events become the durable
record rather than the enforcement mechanism. Access ends synchronously; the
history catches up. Anything less would trade a security property for a
performance one.

What we give up is the ability to enforce a cross-grant invariant
transactionally, should one ever appear. That is a real loss and we take it
knowingly: the invariant we would be protecting is hypothetical, while the
unbounded aggregate is measured and is currently blocking the rollout.

Splitting identity by "content-derived vs minted" rather than by "imported vs
ledger-born" is the rule that removes today's split-brain. Provenance is an
accident of when a fact arrived; what the entity *is* does not change.

## Consequences

- The convergence wait stops being impossible to satisfy. It remains worth
  making progress-based rather than deadline-based, so a large tenant is never
  parked merely for being large, but that is now a refinement rather than the
  fix.
- `AuthzProjectionCursor` is keyed per organization today and becomes keyed per
  aggregate. Its table is replaced rather than migrated.
- The park message must name which facts are outstanding, not only how many.
  Diagnosing the incident that produced this ADR required a database because
  the error reported a count and a deadline and nothing else.
- Replay granularity improves: one grant can be replayed without refolding an
  organization's entire history.
- Ops surfaces that assume one authz aggregate per organization need updating.
- ADR-092 §13's aggregate choice is superseded. The rest of ADR-092 — the
  engine, the fork, the cutover sequencing — stands unchanged.

## References

- Supersedes the aggregate decision in [ADR-092](092-unified-authorization-engine.md) §13
- [ADR-057](057-token-gated-trace-sharing.md) — one-share-per-resource dropped; the token is the credential's identity
- Spec: `specs/rbac/unified-authorization-engine.feature`, `specs/rbac/in-place-authz-migration.feature`
- Incident: organization `HXECRq2mRfSQpxTiSCcsS`, 2026-08-20 — genesis and cutover both parked all day
