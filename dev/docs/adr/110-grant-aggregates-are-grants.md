# ADR-110: A grant is an aggregate; the rollout is one migration

**Date:** 2026-08-20

**Status:** Proposed

**Supersedes:** ADR-092 §13's aggregate choice (`aggregateId = organizationId`)
and its three-stage rollout. The rest of ADR-092 — the engine, the fork, the
vocabulary — stands.

**Builds on:** ADR-100 (the aggregate-scoped lane, which is where per-grant
concurrency comes from), ADR-105 (an aggregate is one declaration).

**Related:** ADR-103 (a run's totals are a query — the same instinct: stop
maintaining what can be derived), ADR-057 (the share token is its own
identity).

## Context

ADR-092 made `organizationId` both the tenant and the aggregate, citing the
`billing_report` precedent — a pipeline whose handler returns `[]` on every
path and therefore never appends, so its fold state is permanently empty and
the shape's flaw could not show. Here it did. One aggregate's fold state
became every grant the organization had ever held, and the state store
reloaded all of it on every event batch.

Measured on organization `HXECRq2mRfSQpxTiSCcsS`, 2026-08-20:

| | |
|---|---|
| grant rows on the aggregate | 69,826 |
| facts landed 10:26 → 16:22 | 326 (~0.015/sec) |
| rate the convergence budget assumed | ~1.8/sec |
| cutover facts awaiting | ~69,500, needing ~10.7 hours |
| budget the ceiling granted | 20 minutes |

The import decelerated as it progressed — every batch re-read a head the
previous batch had grown — so no retry could ever succeed. Every subsystem
reported healthy throughout: commands completed, projection completed, no
blocked groups, 1.3s backlog. Nothing was broken; the arithmetic was.

The rollout is also three migrations where one will do. The team-user backfill
promotes `TeamUser` rows into `RoleBinding` rows so genesis has a uniform
source to adopt; its own docblock says the promoted bindings "replace one for
one", so it changes no access. It exists only to normalise the legacy schema
for the benefit of the next step.

## Decision

**A grant is its own aggregate.** The organization stays the TENANT — the
isolation and routing boundary — and remains the AGGREGATE only for facts that
are genuinely organization-wide.

```
                tenantId = organizationId  (both)
  authz_grant                      authz_org_policy
  id = grantId                     id = organizationId
  one grant's lifecycle            roles, cutover flag, migration state
  ~1-5 events                      tens of events
```

A command may no longer straddle aggregates, so batched `attachGrants` becomes
a singular `attachGrant`: one command per grant, independent, folding
concurrently on ADR-100's lane. We add no group-key override — the lane
already gives per-aggregate mutual exclusion, and the per-organization
serialization being removed was never a lane decision, only a consequence of
every grant sharing one aggregate.

**The rollout is one migration.** Every legacy table is a source of events:

```
OrganizationUser, TeamUser, RoleBinding, CustomRole, ShareLink
        │  emit
        ▼
  events ──► fold ──► Grant / Role projections
        │
        ▼  when the projection agrees with legacy
  cutover_completed on authz_org_policy  ──►  reads fork here
```

Read every source table, emit each fact as an event, let it fold, check the
ledger answers what legacy answers, then emit one `cutover_completed` on the
organization. The read path forks on that single flag. No normalisation step,
no staged prerequisites, no cross-migration state.

**Aggregate ids must be STABLE ACROSS RETRIES, which is not the same as
deterministic.** The event log dedupes on
`(TenantId, AggregateType, AggregateId, IdempotencyKey)`, so `AggregateId` is
part of the dedup key and an idempotency key only dedupes *within* an
aggregate. An id minted freshly per attempt therefore defeats idempotency
outright — the retry lands elsewhere, nothing collapses, and every pass adds
another copy. Derivation is how a writer with no memory satisfies the rule: a
migration retries across processes and days with nowhere to record what it
minted, so the id must be recomputable from the fact. A live write already
mints `commandId` once and reuses it on retry, so a KSUID minted alongside it
is equally stable. Both produce a `grant_`-prefixed KSUID; nothing downstream
can tell them apart.

**The migration does not wait.** It cannot write the head — it can only emit —
so it states its facts and checks once. A check that finds the projection
behind reports the tenant as held, which the next pass revisits. That is a
normal outcome, not an error, and it replaces the convergence wait entirely.

## Rationale / Trade-offs

Bounding the aggregate is what fixes the measurements above: `load()` becomes
a lookup of one row by primary key, so cost per event stops depending on how
much the organization already holds, and 69,500 share links import in parallel
rather than through one queue.

The objection is that some invariants are organization-wide. We accept
eventual consistency for them, because none needs atomicity: a grant naming a
deleted role resolves to the empty permission list, which grants nothing; and
the deny sweep is a query plus compensating commands, which is what it already
was.

Offboarding is the exception and needs care, because the organization
aggregate was carrying a safety property that is easy to drop by accident:
*"the fold sweeps by principal, so an incomplete list cannot leave the member
holding access."* Per-grant aggregates cannot sweep. We keep the guarantee by
moving it to the synchronous projection write ADR-092 decision 7 already
sanctions, so access ends before the call returns and the events become the
record rather than the mechanism. Anything less trades a security property for
a performance one.

What we give up is enforcing a cross-grant invariant transactionally, should
one appear. We take that knowingly: the invariant is hypothetical, the
unbounded aggregate is measured and is blocking the rollout.

## Consequences

- Collapsing three migrations into one means a single pass does more, but the
  only behaviour change is still one event, so the risky moment is unchanged.
- Rollback becomes flipping one flag. The events stay and are inert until it
  is set again.
- Nothing materialises legacy rows before the flip, so the dark period is dark
  by construction rather than by an UPDATE-ONLY rule inside the projection.
- **Open:** the projection's compat writes exist so legacy stays usable for
  rollback *after* the flip. They are not needed before it. Whether they
  survive at all depends on whether rollback must be instant or may replay.
- `AuthzProjectionCursor` becomes keyed per aggregate; its table is replaced.
- A park must name which facts are outstanding. Diagnosing the incident above
  needed a database because the error gave a count and a deadline, nothing
  else.
- Replay granularity improves: one grant replays without refolding an
  organization.

## References

- [ADR-092](092-unified-authorization-engine.md) — partially superseded
- [ADR-100](100-dispatch-plane-group-keys.md), [ADR-105](105-defining-an-aggregate.md) — the lane and the declaration form
- Spec: `specs/rbac/authz-ledger-rollout.feature`
- Incident: `HXECRq2mRfSQpxTiSCcsS`, 2026-08-20

Numbering: 100–109 were all claimed by in-flight branches (the event-sourcing
corpus, the identity redesign), so this record takes 110.
