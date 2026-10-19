# ADR-006: Every Group Queue name defines one Redis Cluster hash slot

**Status:** Accepted

## Context

Group Queue implements atomic transitions with Redis Lua scripts. Every key a
script touches must resolve to the same Redis Cluster slot or Redis rejects the
operation with `CROSSSLOT`.

## Decision

A queue definition owns a validated, unwrapped logical name. Group Queue
derives its physical Redis key prefix with one hash tag and derives every key
used by an atomic script from that prefix.

Different queues use different hash tags. This keeps each queue's atomic key
set together without concentrating all queues on one cluster slot.

Callers cannot pass raw Redis key prefixes or pre-wrapped names. Internal key
builders reject names containing an ambiguous or nested hash tag. Contract
tests enumerate every key passed to each Lua script and prove that the keys
share one slot.

Queue names may appear with braces in low-level Redis diagnostics. Public
metrics and logs also include the logical queue name so operators do not need
to parse storage syntax.

## Consequences

- Atomic queue transitions work on standalone Redis and Redis Cluster.
- Key layout is package-owned and unavailable as an application extension
  point.
- Per-queue tags distribute unrelated queues across the cluster.
- Adding a key to a Lua script requires extending the same-slot contract test.
