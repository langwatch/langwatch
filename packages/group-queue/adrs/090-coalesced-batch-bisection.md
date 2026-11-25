# ADR-090: A failing coalesced batch is halved, not retried whole

**Status:** Accepted

## Context

A coalesced batch is all-or-nothing: `processBatchBisecting` hands every
drained sibling to one handler call. Without splitting, one unprocessable
("poison") payload fails the whole batch, and the retry re-drains the same
siblings into the same batch — the poison payload takes up to
`coalesceMaxBatch - 1` healthy payloads down with it on every attempt until
the group is quarantined. A _size_-driven failure (a batch too heavy for a
downstream query's memory budget) was equally undirected: it only recovered
if the retry happened to re-assemble a lighter set by chance.

## Decision

On a retryable failure, halve the batch and run both halves in sequence, not
concurrently — a fold derives fields from arrival order, so splitting a group
across lanes is unsafe. Keep halving until the batch succeeds or the failure
narrows to a single payload, at which point the throw is attributable to it
and the existing retry/quarantine path takes over. One split mechanism
handles both a too-heavy batch (halves until it fits) and a poison payload
(halves until it is alone).

**Limits of bisection:**

- A throw propagates immediately, so payloads _after_ the offender in the
  batch are never attempted in that pass — stepping over them would apply
  them across a gap the fold cannot see. Bisection recovers everything
  _before_ the offender and names it; it does not rescue what queued behind
  it (tracked separately in #6482).
- Non-retryable failures are not split: they fail identically at every size,
  so bisecting one only multiplies the work before the same verdict.
- Splitting happens while the job holds the group's active key
  (heartbeat-renewed). Work is bounded by `dispatch.splits` so an unbounded
  descent (a handler that only accepts singletons) cannot hold the group lock
  and a worker slot indefinitely instead of yielding to retry/backoff. Once
  the budget is spent, the current failure propagates un-split: committed
  prefixes stay committed and the remainder re-stages through the normal
  failure path. The budget comfortably covers the useful descents — isolating
  one poison payload in a 256-entry batch costs 8 splits, converging to
  sub-batches of 8 costs 31 — and cuts off only the pathological walk where
  backoff is the right behaviour anyway.

**Idempotency across sub-batches:** fold redelivery is idempotent via the
store's applied-event-id set (#6016), but only because every sub-batch call
after the first successful commit carries `delivery.isContinuation`, which
tells the fold commit to _extend_ that set rather than replace it. Without
the flag, each sub-batch commit would erase the ids the earlier sub-batches
recorded, and a retry after a failed later sub-batch would re-apply the
committed prefix (the bug fixed by #6578).

## Consequences

- A poison payload costs at most O(log n) extra handler calls to isolate,
  instead of failing (and re-failing) the whole batch forever.
- Recovery from a size-driven failure is directed rather than accidental.
- The gap directly behind an isolated offender is a known, tracked limitation
  (#6482), not a silent correctness gap.
