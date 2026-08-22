# ADR-110: A grant is an aggregate; finishing the migration is the switch

**Date:** 2026-08-20

**Status:** Proposed

**Supersedes:** ADR-092 §13's aggregate choice (`aggregateId = organizationId`)
and its three-stage rollout. The rest of ADR-092 — the engine, the permission
registry, the fork — stands.

**Builds on:** ADR-100 (the aggregate-scoped lane, which is where per-grant
concurrency comes from), ADR-105 (an aggregate is one declaration).

**Related:** [ADR-113](113-a-pipeline-owns-a-set-of-aggregates.md) (the
framework change that lets one pipeline carry both aggregates under their own
types — until it lands, #7406 stamps both families `authz_grant`), ADR-103 (a run's totals are a query — the same instinct: stop
maintaining what can be derived), ADR-057 (the share token is its own
identity).

## Context

ADR-092 made `organizationId` both the tenant and the aggregate, citing the
`billing_report` precedent — a pipeline whose handler returns `[]` on every
path and therefore never appends, so its fold state is permanently empty and
the shape's flaw could not show. Here it did: one aggregate's state became
every grant the organization had ever held, reloaded in full on every batch.

Measured on organization `HXECRq2mRfSQpxTiSCcsS`, 2026-08-20:

| | |
|---|---|
| grant rows on the aggregate | 69,826 |
| facts landed 10:26 → 16:22 | 326 (~0.015/sec) |
| rate the convergence budget assumed | ~1.8/sec |
| cutover facts awaiting | ~69,500, needing ~10.7 hours |
| budget the ceiling granted | 20 minutes |

The import decelerated as it ran — every batch re-read a head the previous
batch had grown — so no retry could succeed. Every subsystem reported healthy
throughout: commands completed, projection completed, no blocked groups, 1.3s
backlog. Nothing was broken; the arithmetic was.

The rollout carried its own weight. Three migrations with prerequisites
between them, a separate cutover step with a typed confirmation, a cutover
flag on its own projection table, a cached gate in front of that flag, cohort
sampling, and a rollback path through all of it. The first of the three
existed only to normalise `TeamUser` rows into `RoleBinding` rows so the next
one had a single table to read; its own notes record that the promoted
bindings "replace one for one", so it changed no access at all.

## Decision

**A grant is its own aggregate, and so is a role.** The organization is the
TENANT of every event — the isolation and routing boundary — and the aggregate
of nothing.

```
              tenantId = organizationId  (both)
  authz_grant                    authz_role
  id = grantId                   id = roleId
  one grant's lifecycle          one role definition's lifecycle
```

There is no organization-keyed aggregate. Roles, which an earlier draft put on
one, are entities with their own lifecycle and their own referents
(`custom:<id>`); "there are only a few of them" is a fact about size, not a
reason to share a boundary. Rollout state is not on an authorization aggregate
either — see below, where it stops existing.

A command may no longer straddle aggregates, so batched writes become
singular: one command states one grant. We add no group-key override — ADR-100's
lane already gives per-aggregate mutual exclusion, so one organization's grants
fold concurrently for free. The per-organization serialization being removed
was never a lane decision; it was a consequence of every grant sharing one
aggregate.

**One migration, and finishing it IS the switch.** Every legacy table is a
source of facts. There is no second step.

```
OrganizationUser, TeamUser, RoleBinding, CustomRole, ShareLink, Project.apiKey
        │  state each row as an event
        ▼
  events ──► projection (Grant, Role)
        │
        ▼  the check agrees with legacy
  migration finalized  ═══►  this organization reads from the projection
```

The migration's own status is the fork. An organization whose migration is
finalized reads from the projection; one that is not reads from legacy. That
deletes, outright:

- the cutover step, and the typed confirmation guarding it
- `cutover_completed` / `cutover_rolled_back` events and their commands
- the `AuthzCutoverProjection` table and the cached gate in front of it
- `enforceCutoverRollback`, and with it one of the three queue-bypassing writes
- cohort sampling, prerequisites, and cross-migration state

Rolling back is one lever: an operator moves the organization's status off
finalized and reads return to legacy. The events stay and are inert until it
is finalized again.

**Enrollment is a switch, not a programme.** Either an organization is
enrolled, or the migration is on for everyone. No sampling, no cohorts, no
pacing ladder. Self-hosted runs it for every organization automatically, as it
already did.

**Aggregate ids must be STABLE ACROSS RETRIES, which is not determinism.** The
event log dedupes on `(TenantId, AggregateType, AggregateId, IdempotencyKey)`,
so `AggregateId` is part of the dedup key and an idempotency key only dedupes
*within* an aggregate. An id minted freshly per attempt defeats idempotency
outright — the retry lands elsewhere, nothing collapses, and every pass adds
another copy. A migrated fact therefore keeps the legacy row's own id, which is
already a public handle (`DELETE /role-bindings/:id`); a fact the legacy schema
only inferred derives its id from its content; a live write mints a KSUID,
stable because its `commandId` is minted once and reused on retry. Nothing
downstream can tell them apart, and nothing may rely on their shape: a kept
legacy id is an unprefixed `nanoid()`, a live binding is minted as
`rolebinding_…`, and only a derived id reads `grant_…`. (An earlier draft
claimed all three were `grant_`-prefixed; ADR-113 records why that would have
mattered and why it is not true.)

**The migration does not wait.** It cannot write the projection — it can only
state events — so it states its facts and checks once. A check that finds the
projection behind reports the organization as held, and the next pass revisits
it. That is a normal outcome, not an error, and it replaces the convergence
wait entirely.

**Every write goes through the group queue.** No bypass, no inline fold. If
Redis is down, authorization writes are down; that is a stated position, not an
omission. The one exception is deny-only: a revocation and an offboarding write
the projection synchronously so access ends before the call returns, and both
are counted and logged
(`langwatch_authz_direct_projection_write_total{reason}`) because they are the
only authz writes whose effect can exist without an event behind it.

## Rationale / Trade-offs

Bounding the aggregate is what fixes the measurements above: a projection write
becomes a lookup of one row by primary key, so cost per event stops depending
on how much the organization already holds, and 69,500 share links import in
parallel rather than through one queue.

Collapsing the rollout is the larger saving in complexity, and the argument for
the two-step version was never strong. A separate cutover buys the ability to
finish importing and then decide, later, whether to switch. In practice the
decision was already made by the check that precedes it: if the projection
agrees with legacy, we switch; if it does not, we do not. Holding a proven
organization in a finished-but-not-switched state served nobody, and it cost a
table, an event pair, a cached gate, a confirmation dialog and a rollback path
through all of them.

The objection is that some invariants are organization-wide. We accept eventual
consistency for them, because none needs atomicity: a grant naming a deleted
role resolves to the empty permission list, which grants nothing, and the deny
sweep is a query plus compensating commands, which is what it already was.

Offboarding is the exception and needs care, because the organization aggregate
was carrying a safety property that is easy to drop by accident: *"the fold
sweeps by principal, so an incomplete list cannot leave the member holding
access."* Per-grant aggregates cannot sweep. We keep it by making enforcement
take a **principal filter** rather than a list of ids — the shape SpiceDB uses
for `DeleteRelationships` — so it removes what the caller could not enumerate.
Anything less trades a security property for a performance one.

What we give up is enforcing a cross-grant invariant transactionally, should one
appear. We take that knowingly: the invariant is hypothetical, the unbounded
aggregate is measured and was blocking the rollout.

## Consequences

- The read fork reads the migration's status instead of a cutover flag: one
  source of truth where there were two, and one fewer table to keep in step.
- Rollback is a status change. It applies within the status lookup's cache
  window rather than instantly, and that bound should be documented rather than
  discovered.
- Nothing writes legacy rows before an organization finishes, so the migration
  is dark by construction rather than by an UPDATE-ONLY rule in the projection.
- **Open:** whether the projection's compat writes survive at all. They exist so
  legacy stays usable for rollback after the switch; if rollback may replay
  instead, they go.
- Replay is a privilege-restoration vector: a revocation applied during a Redis
  outage has no event behind it, so a rebuild resurrects the access. A replay
  must account for the bypass counter before it runs.
- A held organization must name which facts are outstanding. Diagnosing the
  incident above needed a database because the error gave a count and a
  deadline and nothing else.
- Share tokens should be stored hashed in the projection. The import otherwise
  duplicates a bearer credential into a second table in the clear.

## References

- [ADR-092](092-unified-authorization-engine.md) — partially superseded
- [ADR-100](100-dispatch-plane-group-keys.md), [ADR-105](105-defining-an-aggregate.md) — the lane and the declaration form
- Specs: `specs/rbac/authz-grants.feature`, `specs/migration/authz-grants-rollout.feature`
- Incident: `HXECRq2mRfSQpxTiSCcsS`, 2026-08-20

Numbering: 100–109 were all claimed by in-flight branches (the event-sourcing
corpus, the identity redesign), so this record takes 110.
