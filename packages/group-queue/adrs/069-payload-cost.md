# ADR-069: Payload cost is an explicit scheduling input

**Status:** Accepted

**Behavioural contract:**
[payload-cost.feature](../specs/payload-cost.feature)

## Context

Job count alone is not a useful capacity measure when payloads vary by orders
of magnitude. A queue can remain within its concurrency limit while decoded
bodies, coalesced batches and handler working sets exhaust process memory.

## Decision

Every queue definition declares how to obtain a bounded payload cost. The
producer records the encoded and decoded byte information available at the
staging boundary; the consumer validates it against the decoded body.

Admission, batching and coalescing use byte budgets as well as item counts. A
single item above a batch budget is isolated and processed under the queue's
single-item policy rather than waiting forever for a batch it can fit.

Waiting work carries the smallest sufficient representation:

- a content reference when the handler needs the canonical body;
- a bounded derivation when the handler needs only a closed set of facts; or
- the typed body when it is already within the inline budget.

A representation the consumer cannot validate fails through the queue's
normal error path. It is not treated as irrelevant work or successful
completion.

Memory permits are acquired from declared/validated bytes before expensive
decode and handler work. Metrics expose queued bytes, admitted bytes, rejected
cost declarations and the difference between declared and observed cost.

## Consequences

- Queue capacity and coalescing remain meaningful for heterogeneous jobs.
- Producers cannot opt out of cost accounting for large work.
- Handlers receive typed payloads and do not implement memory policy.
- The application chooses limits as construction data; Group Queue enforces
  them without importing application configuration services.
