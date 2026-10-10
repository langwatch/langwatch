# ADR-001: singular Langy service boundary

**Status:** accepted

**Behavioural contract:** [Langy service capability](../specs/langy.feature)

## Context

Langy behaviour was spread across the app, server paths and feature packages,
with callers able to reach subordinate implementations.

## Decision

The singular `langy` feature owns conversations, turns, messages, credentials,
relay frames, feedback cadence, eventing and reusable browser presentation. It
exposes one portable `LangyService`.

## Public surfaces and transports

tRPC names, HTTP paths, relay frames, worker endpoints and response shapes do
not change. The web package owns controlled presentation and deterministic
browser behaviour; app pages, state, routing, route builders, and transport
hooks remain composition. Capability resolution, feature-map lookups, result
formatting, derived cards, failed-card disclosures, choices, and streaming
previews are web-owned. The app supplies only named ports for viewer hydration,
SPA links, and the analytics chart.

## Dependencies

The concrete service receives its private collaborators. Presentation that
needs app metadata receives a small named port, not a context bag.

## Persistence

Postgres repositories and Redis feedback records are private to the server.
Redis reads fail closed and writes are best effort. Feedback remains disabled
before two assistant answers, quiet for three days, exceptional for long
conversations, and retained for 30 days.

## Runtime and registration

`PostgresLangyAdapter` builds the private graph. Each process composes one
service and injects it into transports and workers. The package-owned HTTP
worker adapter owns manager probe, warm, dispatch, and cancel calls; requests
never construct or locate the service globally.

## Environment and configuration

Configuration and technology adapters enter at process composition. Contract,
server and web packages do not read app environment modules. Boot validates
the manager URL and internal secret as one optional pair and injects semantic
configuration. A configured process constructs one HTTP adapter with an
explicit metrics port; an unconfigured process does not admit new turns.

## Errors

Contract errors cross transports through the existing mappings. Optional Redis
feedback storage does not make the main Langy path fail.

## Contracts and validation

Portable contract schemas define transport and relay values. Transports parse
those values and call flat `LangyService` methods.

## Consequences

There is one discoverable service and lifecycle. Server persistence stays
private, while reusable browser behaviour no longer lives in app feature code.
