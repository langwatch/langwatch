# Group Queue architecture

Group Queue owns transport mechanics only. It accepts typed work, preserves
ordering and identity, and delivers work to a handler. It does not know whether
the work represents an event, projection, subscriber, or product operation.

## Contract and capabilities

`defineGroupQueue` fixes five things:

- the logical queue name;
- the payload decoder;
- the group key;
- the stable job identity;
- optional scheduling and coalescing policy.

`GroupQueueProducer` can stage work and cannot register a handler.
`GroupQueueConsumer` can register a handler and cannot stage work. The
consumer returns a running capability with readiness, concurrency and drain
operations.

## Redis model

Every transport name is Redis Cluster hash tagged. Queue keys therefore share
one slot and Lua can update the group jobs, stored values, ready index, active
marker, deduplication key and wake-up signal atomically.

Jobs in a group are dispatched in score order. An active marker prevents two
consumers from processing the same group simultaneously. Different groups can
occupy independent local concurrency slots.

## Persisted envelope

Every stored value uses `GQ2|<header-length>|<header-json><body>`. The header
contains routing, payload cost, retry machinery and any content-addressed blob
reference. Redis-side inspection reads the header without parsing or hydrating
the body.

Small payloads stay inline. Larger payloads are compressed and stored by
content hash in Redis or the injected durable object store. Per-stage renewable
leases protect shared bytes while work is live; TTLs reclaim bytes after
holders disappear.

An unsupported or malformed stored value is classified through the decode
failure path, is never supplied to a handler, and does not prevent the next job
in the group from being dispatched.

## Application ports

The composition root supplies:

- Redis;
- validated concurrency and drain budgets;
- optional context capture and restoration;
- optional activity reporting;
- optional failure classification;
- optional durable object storage.

These are data and narrow interfaces. The package has no application, Eventing,
enterprise, feature-flag, billing, or tenant-tracker dependency.
