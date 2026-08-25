# ADR-001: singular Langy service boundary

**Status:** accepted

**Behavioural contract:** [Langy service capability](../specs/langy.feature)

## Decision

The `langy` feature owns conversations, turns, messages, credentials, relay
frames, feedback cadence, and its event-sourcing pipeline. It exposes one
portable `LangyService` contract. The server package implements that contract
with private repositories and services; the application does not construct or
reach through subordinate Langy services.

`PostgresLangyAdapter` is the server composition seam. It constructs the
private persistence graph once and returns the contract service. `AppLangyRuntime`
is the application wrapper around that adapter. The process composition root
builds one instance and injects it into transports and workers.

The feedback prompt is part of `LangyService` through `shouldAskFeedback` and
`markFeedbackShown`. Its Redis record, parser, constants, and implementation
are private to `@langwatch/langy-server`. Redis reads fail closed; writes are
best effort. The current cadence remains: no prompt before two assistant
answers, a three-day quiet period, a long-conversation exception, and a
30-day Redis TTL.

The contract and server package do not import application aliases, Hono,
React, or global Prisma. Configuration and technology adapters are supplied at
the process boundary. No request constructs a service or resolves one through
`getApp`.

## Compatibility

tRPC procedures, HTTP paths, relay frames, worker endpoints, and response
shapes remain unchanged. Transports validate contract values and delegate to
the flat `LangyService` methods.

## Consequences

There is one discoverable Langy capability and one lifecycle. Persistence and
Redis details remain replaceable and private, while the feature contract can
be used by the app, public/internal APIs, workers, and browser client without
duplicating ownership.
