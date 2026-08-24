# ADR-001: Singular Langy service boundary

**Status:** Accepted

**Behavioural contract:** [Langy service capability](../specs/langy.feature)

## Context

Langy currently spans event-sourced conversations, turn admission, messages,
worker credentials, relay frames, compatibility routes, and browser state. A
directory split that leaves separate conversation, turn, message, or credential
services would preserve the duplicate ownership that this extraction removes.

## Decision

The singular `langy` feature owns the portable Langy vocabulary and exposes one
abstract `LangyService` capability. The server implementation receives private
conversation, turn, message, credential, and relay repositories. Compatibility
transports are classes that validate contract values and delegate to that one
service. The event-sourcing vocabulary, folds, card schemas, credential facts,
and inline channel now live in the feature contract. There is no second legacy
Langy package surface.

The server package also owns the durable Langy command pipeline, process
evolution, folds, and map projections. Its public root exposes one
`PostgresLangyAdapter`; that adapter constructs the private conversation and
message persistence adapters and returns the contract `LangyService`. Application
code does not construct a parallel conversation, message, or credential service
surface.

The application composition wrapper is `AppLangyRuntime`. Its
`create(options).build()` API accepts the process-owned database as an opaque
`object`, the command/event/runtime ports, and already-composed application
capabilities. It delegates package-server construction to `PostgresLangyAdapter`.
The wrapper does not implement or export a database port.

The contract service is also the application-facing seam. Conversation reads,
messages, turn orchestration, feedback cadence, model allowlist reads, and the
durable relay/process operations are flat methods on `LangyService`. App
dependencies and transports depend on `@langwatch/langy-contract`; they do not
reach through `conversations`, `turns`, `messages`, `credentials`, or
`feedbackPrompt` capability properties.

## Public surfaces and transports

The contract is consumed by tRPC, public/internal HTTP adapters, workers, and
the browser client. Existing procedure names, REST paths, relay frames, and
deployment endpoints remain compatibility surfaces.

## Dependencies

Composition supplies the canonical GitHub, Model Provider, and Gateway service
capabilities to the Langy implementation. Langy does not import their
repositories or construct them. The server package does not import application
aliases, Hono, React, or a global App.

## Persistence

Conversation, turn, message, credential, and relay persistence ports are
private to `server`. Technology adapters bind them at the process composition
root; generated database types must not cross the package boundary.

## Runtime and registration

One `LangyService` instance is constructed by the process composition root and
injected into Hono, tRPC, and worker handlers. Requests never construct a
service or recover one from a global Prisma client.

## Environment and configuration

Worker endpoints, gateway URLs, credentials, and feature flags are resolved by
composition/configuration adapters and passed as capabilities or values. The
contract and service modules perform no import-time environment reads.

## Errors

The service throws typed Langy domain errors for missing conversations and
credential resolution failures. Adapters preserve those errors while mapping
transport-specific status and wire envelopes.

## Contracts and validation

All transport inputs and relay frames are parsed with Zod 4 schemas from the
contract package. Event-sourcing wire contracts continue to use the existing
portable schemas so browser and server folds remain byte-compatible.

## Consequences

Langy has one discoverable service capability and one process-owned lifecycle;
repositories remain replaceable and private. The application-owned event
envelope, conversation/message repositories, frame authentication,
final-part assembly, credential resolution service, and conversation service
now live under the feature server surface. The process composition still
binds the application-specific auth/key provisioning, turn orchestration,
worker ports, and projection adapters through injected capability adapters;
compatibility routes remain unchanged.
