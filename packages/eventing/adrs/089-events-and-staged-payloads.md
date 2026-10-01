# ADR-089: Events are durable facts; staged payloads are transport DTOs

**Status:** Accepted

## Context

An event and a queue payload can both be versioned and schema-validated, but
they have different meanings. Treating every typed queue body as an event
makes durability and replayability impossible to infer from its type.

## Decision

An **event** is an immutable fact appended to the event log. It is replayable,
belongs to an aggregate definition and may be consumed by projections,
subscribers and process managers. Only durable facts use the Eventing event
contract.

A **staged payload** is a typed DTO owned by one queue lane. It may carry a
reference, a bounded derivation or another handler-specific body. It is
validated at the queue boundary, but it is never appended, folded or replayed
and does not implement the Eventing event contract.

There is no universal staged-payload base type or mutable framework registry.
Each queue definition owns its payload schema and the handler receives the
schema's inferred type. When a pipeline stages either an event or another DTO,
that union is explicit at the authoring seam.

The exhaustive event-log consumers are:

- projections, which derive rebuildable state;
- event and projection subscribers, which receive live delivery; and
- process managers, which turn committed events into durable orchestration.

Queue redelivery is delivery of the same staged payload, not replay of event
history. Stable event and job identities make that redelivery retry-safe.

## Consequences

- A type's event contract states that it is durably appended.
- Queue-only DTOs can evolve with their owning lane without polluting the
  application event catalogue.
- Subscribers that stage a derived body define and test that body explicitly.
- The application catalogue contains durable event definitions only.
