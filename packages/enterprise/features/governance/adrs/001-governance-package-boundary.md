# ADR-001: Governance owns portable ingestion and usage contracts

**Status:** Accepted

**Behavioural contract:** [Enterprise governance](../specs/governance.feature)

## Context

Governance UI, database queries, provider pullers, Eventing definitions, and
transport handlers grew together below an application alias. That made the
application itself the only place governance behavior could be composed.

## Decision

Create portable governance contracts and separate server and web packages.
The ingestion-pull and pulled-usage workflows belong to governance rather than
to a generic Enterprise event-sourcing directory.

## Public surfaces and transports

Each package exports only its root. Contracts describe facts and capabilities;
REST, RPC, tRPC, Eventing, and browser code are adapters or consumers.

## Dependencies

The contract uses Zod 4 and Croner. It imports no application, server,
database, request-framework, or Eventing runtime type.

## Persistence

Server persistence is accessed through narrow class ports. Generated Prisma
types may occur only inside strict `server/src/repositories/prisma/**` adapters.

## Runtime and registration

Services, projections, and adapters are classes constructed by composition
roots. Importing a governance package does not register a worker or timer.

## Environment and configuration

Credentials, environment values, clocks, metrics, and provider clients are
injected at server construction boundaries.

## Errors

Transport-safe validation errors remain handled domain errors. Provider
failures are reported through outcome ports after the configured retry budget.

## Contracts and validation

Commands, events, schedules, source types, and pulled-usage money facts use
Zod 4 schemas and inferred portable types. No generated or server type is
reachable from the contract root.

## Consequences

API and worker runtimes can share one governance model. Eventing registration
remains a composition concern and must use the same contract facts once its
schema boundary consumes Standard Schema/Zod 4.
