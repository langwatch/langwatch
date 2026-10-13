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

## Reading byte cost without a decode

`readJobPayloadBytes` (`jobEnvelope.ts`) answers a staged value's byte cost
without decoding it, in three cases:

1. The header's `s` field is a non-negative safe integer — the encoder's
   recorded size, trusted as exact. Anything else in that field (fractional,
   `Infinity`, `NaN`, negative) is untrusted: a forged or corrupt header must
   not be able to talk the budget down, so these fall through to case 2/3.
2. No `s`, body inline and uncompressed (`e:"j"`) — the stored length is a
   safe, conservative estimate.
3. No `s`, body compressed or offloaded — the stored length is a fraction of
   the true payload with nothing in the value to say by how much, so the
   function costs it at `MAX_BLOB_BYTES`, the largest payload the system
   accepts.

Case 3 exists for the length of a rolling deploy: old workers keep staging
pre-`s` envelopes while new ones drain them, and the backlog is deepest
exactly where the byte bound matters most. Reading the stored length there
would reinstate the defect `s` was added to close, at the worst possible
moment. Costing the cap instead sacrifices coalescing on those jobs (any sane
`coalesceMaxBytes` is far under `MAX_BLOB_BYTES`) rather than the bound
itself.

`readJobPayloadBytes` never throws — an unparseable value is worth its own
stored length, not an exception on the drain path — and has a Lua twin,
`gqPayloadSize` in `scripts.ts`, making the same three decisions inside
Redis. An envelope-format change (new prefix, renamed header field, different
length-prefix encoding) has to land in both, or the two ends of one budget
silently disagree.
