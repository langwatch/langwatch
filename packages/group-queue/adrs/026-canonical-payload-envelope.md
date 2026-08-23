# ADR-026: Group Queue stores one canonical payload envelope

**Status:** Accepted

**Behavioural contract:**
[payload-envelope.feature](../specs/payload-envelope.feature)

## Context

Queue scheduling must inspect identity, routing and cost without decoding a
possibly large application payload. Payload bodies also need bounded encoding,
compression and optional external storage without leaking those mechanics into
handlers.

## Decision

Every staged value is a `GroupQueueEnvelope` with an explicit version and two
parts:

- a small inline routing header containing queue-owned metadata; and
- a body represented either inline or by a validated content reference.

The header contains the stable job identity, payload codec, body location,
encoded size, integrity metadata and retry attempt. It never contains product
payload fields. Lua scripts may read the bounded header for scheduling and
lifecycle transitions without decoding the body.

The body codec validates these bounds before allocating or inflating data:

- maximum header length;
- maximum encoded body length;
- maximum decoded body length; and
- a compression ratio guard.

The consumer resolves and decodes the body, validates it against the queue
definition's payload schema, and only then invokes the application handler.
Unsupported or malformed values follow the queue's explicit loss/error path;
they are never passed to a handler or counted as successful work.

Queue machinery may update header-owned state, such as the attempt, without
changing the payload bytes or the referenced content identity.

## Consequences

- Scheduling and retry logic do not deserialize application payloads.
- Payload compression and offload are transparent to handlers.
- Decode failures are attributable and cannot wedge the rest of a group.
- The persisted version remains visible even though there is one accepted
  envelope contract.
