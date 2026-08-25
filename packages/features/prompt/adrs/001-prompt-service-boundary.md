# ADR-001: One Prompt service boundary

**Status:** Accepted
**Behavioural contract:** [Prompt service](../specs/prompt.feature)

## Context

Prompt configurations, immutable versions, tags, copies, sync behaviour, and
SDK Prompt metadata had accumulated in application transports and trace code.
That exposed persistence and Prompt interpretation to callers that should only
adapt transport or trace data.

## Decision

`prompt` is one singular feature: versions and tags are subordinate Prompt
behaviour, not independent features.

- `@langwatch/prompt-contract` owns portable Zod 4 schemas, values, errors,
  shorthand parsing, trace-attribute parsing, and the abstract Prompt service
  capability. It has no app, Prisma, tRPC, Hono, React, or environment imports.
- `@langwatch/prompt-server` owns the implementation, private repository port,
  and persistence adapters. Generated Prisma records remain inside those
  adapters.
- `@langwatch/prompt-web` owns browser-safe Prompt presentation helpers and
  components. It receives data and callbacks from app composition.

The app constructs one Prompt service. Existing tRPC procedures and
`/api/prompts` remain compatibility transports: they keep their authentication,
permission checks, routes, envelopes, and error mapping, and call that service
without constructing repositories or services per request. Trace continues to
own trace traversal; it consumes the Prompt contract to interpret Prompt SDK
attributes.

Prompt may consume Model Provider only through its contract. Runtime
configuration is passed at composition, never read at import time.

## Consequences

Prompt behaviour and its portable vocabulary can evolve independently of the
app shell. Transports stay stable while persistence and UI implementation move
behind the Prompt surfaces. Consumers of Prompt SDK metadata share one parser,
so trace projections and trace views retain identical shorthand, version, tag,
and variable semantics.
