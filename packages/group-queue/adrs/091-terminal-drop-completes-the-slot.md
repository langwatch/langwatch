# ADR-091: A terminal drop completes the slot; the caller states bodyPreserved

**Status:** Accepted

## Context

`dropStagedJob` gives up on a staged job the queue cannot process (#5538) —
most often a `body_unreadable`/`missing_blob` decode failure. The code this
replaced justified itself with "recoverable via event replay". It is not, for
a subscriber job: `ReplayExecutor` calls the fold's pure `projection.apply()`
and writes straight to the store via `store.store()`, never constructing a
`ProjectionRouter`, which is the only thing that calls `dispatchToSubscribers`.
Subscribers are unreachable from replay by construction — `replay/` contains
no reference to a subscriber except two that exist to _suppress_ re-fires.

`governanceOcsfEventsSync` (OCSF audit) and `governanceKpisSync` are
subscribers on the `traceSummary` fold, so for them this method IS the
terminal event, and `gq_jobs_dropped_total` is the only evidence it ever
happened. This is scoped honestly: fold/map projection drops genuinely ARE
replay-covered (`ReplayService.replay` drives `config.projections` and
`config.mapProjections`). The false-binary claim was subscriber-specific.

## Decision

**There are three options when a staged job's body can't be read, not two:**

1. `parkPoisonGroup()` blocks the whole group. Right for an oversized payload
   (the value is intact; a raised cap could process it later). Wrong here — a
   missing blob never comes back, so parking would freeze that aggregate
   forever on a job that can never succeed.
2. `retryRestage` (the ladder `handleTransientDecode` rides) is arguably the
   _right_ answer for `body_unreadable`: `JOB_RETRY_CONFIG`'s own budget
   exists to "ride out a rolling restart… without parking the group," which is
   precisely the codec-skew case — retrying would hand the job to a newer
   worker that can read it. **Deliberately deferred (#5823), not overlooked**:
   it changes delivery behaviour for every unreadable body and deserves its
   own change. This one only stops the loss being silent.
3. `complete()` — chosen. Liveness is the one thing the old drop got right,
   and it's a strict improvement over silence even though it's a half-measure
   (the body stays alive to its TTL backstop and is named, but nothing
   re-delivers it).

Lease release is non-destructive: every terminal drop retires its liveness
claim, while Redis expiry or the durable-store lifecycle preserves and later
reclaims the shared bytes independently. A body-present codec-skew drop can
therefore leave its bytes inspectable without pretending a completed slot is
still a live lease holder.

**`recordDrop`'s `bodyPreserved` is caller-stated, never derived.** Only the
caller knows whether it released the body — `retry_encode_failed` releases
deliberately (the body was already read; what failed is the re-encode), so
deriving `bodyPreserved` from `reason` would have made the log assert
`bodyPreserved: true` one line before destroying the body. That false claim on
the structured field oncall filters on is exactly the defect this change
exists to remove.

## Consequences

- `gq_jobs_dropped_total` / `dropStagedJob` is the true terminal event for a
  subscriber whose body cannot be read; nothing else will fire it.
- Retrying `body_unreadable` instead of completing it is tracked, scoped work
  (#5823), not a gap discovered by accident.
- `bodyPreserved` on a drop log is trustworthy because it is asserted by the
  one caller who did (or didn't) release the lease, never inferred.
