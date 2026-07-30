# ADR-106: A projection declares what it is, and the mount refuses illegal combinations

**Date:** 2026-07-30

**Status:** Accepted — the checker is the single home for a rule that was
previously written three times in three places.

**Builds on:** ADR-098 (the two projection kinds, and order-invariance), ADR-099
(the three store kinds, and which of them is not idempotent), ADR-100 (the group
key's scope, and what a lane may collapse).

## Context

Three rules have accumulated across this ADR set, and they are the same rule
wearing three costumes.

- **A fold's lane must be scoped to one aggregate** (ADR-100). Two concurrent
  applies to one aggregate lose an update that no read-time dedup recovers.
- **A `map` writing to a `merge` store must declare how a redelivered write
  avoids double counting** (ADR-099). The engine adds; nothing else stops it.
- **A fold may not collapse its lane to the latest event** (ADR-100). A fold
  accumulates, so an event it never sees is a contribution permanently missing.

Each was discovered separately, and each was going to be enforced separately —
one in the table definition, one in the group-key construction, one in the queue
configuration. Three checkers, three error messages, three places for the next
rule to fail to be added.

They share a shape worth naming. Every one is a statement about a *combination*
of independently-declared properties, every one is decidable before a single
event is processed, and every one has a failure mode that is silent. A fold on
an event-scoped lane does not crash — it quietly loses updates under
concurrency. A map on an aggregating store does not crash — it reports numbers
that are too high. A fold collapsing to latest does not crash — it undercounts,
which is indistinguishable from sampling.

Silence is what makes them worth a compile-time answer rather than a runbook.

## Decision

### 1. A mount is a descriptor, and the descriptor is checked

Everything a projection needs to declare travels together:

```ts
interface Mount {
  readonly projection: "fold" | "map";
  readonly store: "append" | "replace" | "merge";
  readonly scope: "aggregate" | "event" | "partition" | "global";
  readonly collapse: "none" | "batch" | "latest";
  /** Required when `store` is `merge`; refused otherwise. */
  readonly idempotency?: "upstream-exactly-once" | "whole-bucket-replace";
}
```

One function validates it, at composition time, and every rule lives there.
Adding a rule means adding a case to one checker, not remembering which of three
files owns it.

### 2. The illegal combinations, stated once

| combination | refused because |
| --- | --- |
| `fold` + scope other than `aggregate` | two concurrent applies to one aggregate lose an update, and no read-time dedup recovers it |
| `fold` + `collapse: "latest"` | a fold accumulates, so a discarded event is a contribution that never arrives |
| scope `event` + `collapse: "batch"` | a lane holding one event can never form a batch, so the setting is a no-op that reads as an optimisation |
| `fold` + a store other than `replace` | a fold reads its prior state back, which only a `replace` store offers |
| `map` + `replace` | no executor accepts it — a map's executor takes an append or merge store, so this mount would validate with nothing able to run it |
| `merge`, at all | see decision 5 — the kind is closed, and the checker has no reopening mechanism |

The table is exhaustive over the combinations the system can express, and it is
the ADR's actual content — the prose above it exists to explain why a table is
the right form.

### 5. `merge` is closed, because its problem is not a missing column

The obvious fix for a `merge` store's non-idempotency is an idempotency key on
every row, so a repeated write collapses the way it does everywhere else. That
works for `append` — a key in the sort key makes a duplicate insert collapse,
which is why decision 2 no longer carries a per-record-identity special case
(ADR-099).

It cannot work for `merge`. `AggregatingMergeTree` combines rows *by the sort
key*, so a per-write discriminator in that key means two writes no longer share
a key and never combine. The result is one row per write: an append table
wearing a rollup's name. The property that makes the engine useful — many writes
collapsing into one aggregate — is the same property that makes a write
identifier impossible.

So a `merge` store's non-idempotency is not a gap to be guarded. It is what
`AggregatingMergeTree` is, and the honest responses are to stop using it or to
guarantee exactly-once upstream, which nothing in this system can.

`merge` is therefore closed to new tables. The three that exist —
`trace_analytics_rollup`, `evaluation_analytics_rollup` and
`gateway_budget_scope_totals` — are named debt with a stated exit (ADR-099), and
each leaves by one of two routes: a `replace` store written with the whole
bucket value, or derivation at read time. Guarding a kind nobody new may choose
is cheaper than guarding one everybody may.

**The checker refuses `merge` unconditionally, and carries no grandfathering
mechanism.** That is deliberate rather than an oversight, and it works because
the three existing tables do not pass through this checker: they are mounted by
pipelines that have not yet been rewritten. By the time one of them reaches a
mount, it has been rewritten — and the rewrite is precisely where it leaves
`merge`. An allowlist would be a permanent affordance built for three rows that
are supposed to disappear, and every such affordance eventually acquires a
fourth entry.

### 3. Refusal happens at composition, not at first event

The checker runs where a pipeline is assembled, so an illegal mount fails a
deploy. The alternative — validating on the first delivery — moves the failure
into production and makes it a per-aggregate error rather than a build error, at
which point some aggregates have already been written wrongly.

### 4. `collapse` distinguishes two things that are opposites

`batch` and `latest` are not variants. `batch` hands the handler every event in
the lane; `latest` hands it one and discards the rest. Naming them as settings
of one knob is what let a fold be configured with a discarding one.

`latest` is legal only for a handler that recomputes everything it needs from
current state — a "this changed, rebuild it" trigger, where collapsing ten
wake-ups into one rebuild is the entire point. That is why the rule above
forbids it for folds specifically rather than discouraging it generally.

Redelivery dedup is a third thing again and is **not** a `collapse` mode. It
concerns the same event arriving twice, it is a correctness mechanism rather
than a tuning knob, and it is keyed on delivery identity (ADR-098). Putting it
on this enum would suggest it were optional.

## Rationale / Trade-offs

**Why a checker rather than types alone?** Some of these are expressible in the
type system and some are not — `idempotency` required only for `merge` is, while
"this scope can never form a batch" depends on a value. A single runtime checker
covers both uniformly, and the types narrow what they can on top. Splitting the
enforcement across both mechanisms by capability would put half the rules
somewhere a reader does not look.

**Why not enforce at first delivery, where more is known?** Nothing relevant is
known then that is not known at composition. The properties are all declared
statically; waiting only delays the answer until it is expensive.

**What this costs.** One more thing to declare per projection. That is real, and
it is the point: `collapse` and `idempotency` were previously implied by silence,
and the defaults were whatever the first adopter happened to need.

## Consequences

- **Three scattered guards become one table**, which is enumerable — the legal
  combinations can be printed, and a new store kind or scope forces a decision
  about every existing row rather than being added quietly.
- **A fold can no longer be configured to discard events.** This is a real
  behaviour change for any handler currently using aggregate-keyed collapse; each
  has to say whether it recomputes or accumulates.
- **`merge`-backed maps must answer a question they were not previously asked.**
  The two analytics rollups and the gateway budget totals are the current
  population, and none of them has a recorded answer today.
- The checker is a new failure surface at boot. That is deliberate — it fails a
  deploy rather than a customer's numbers.

## References

- ADR-098 — the projection kinds and why ordering is best effort.
- ADR-099 — the store kinds, and `map` + `merge` as the one non-idempotent cell.
- ADR-100 — the group key, its scopes, and what a lane may collapse.
- `specs/event-sourcing/dispatch-group-key.feature` — the scope contract this
  checker enforces one half of.
