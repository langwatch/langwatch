# ADR-001: Evaluator is a contract, server and web feature

**Date:** 2026-08-24

**Status:** Accepted

**Behaviour:** [Evaluator package boundary](../specs/evaluator-service.feature)

**Related:** [ADR-101](../../../../dev/docs/adr/101-feature-package-surfaces.md)

## Context

Evaluator definitions, catalogue vocabulary and persistence must remain portable
to Evaluation execution while hosts retain transport and page composition.

## Decision

Evaluator owns one portable Zod 4 contract and one process-owned service. The
contract contains evaluator definitions, configuration, catalogue data, errors
and the abstract `EvaluatorService`. The server keeps its concrete service,
repository and Postgres persistence private; only the composition adapter is
public. It depends on the full Workflow service and an audit capability.

`@langwatch/evaluator-web` owns browser-safe evaluator pickers, cards,
code-evaluator authoring and editor chrome. The host supplies navigation,
availability, Monaco and field-mapping presentation. The web package never
imports app aliases, tRPC or server code.

The application composes the service once and exposes it through request and
worker context. Existing REST and tRPC URLs remain compatibility adapters and
preserve their response and authorization behaviour. Evaluation execution
remains in the Evaluation feature and reaches evaluators through this service.

## Boundary

- Prisma types stay under `server/src/repositories/prisma`.
- Contract schemas and returned values are transport-safe.
- Ordinary lookups throw typed errors; nullable discovery is named `try*`.
- Pages, drawer routing, API snippets, Langy context, copy/cascade work and
  optimization orchestration remain host composition until their own moves.

This replaces the previous app-owned evaluator vocabulary and per-transport
construction without changing the public API.

## Public surfaces and transports

The contract exposes evaluator values and `EvaluatorService`. The server
exports its composition adapter, and existing REST and tRPC names remain thin
compatibility transports over the composed service.

## Dependencies

The server receives complete Workflow and audit capabilities. Evaluation uses
the Evaluator contract service and does not import evaluator persistence.

## Persistence

The server's Prisma repository is private and maps database rows to contract
values before they leave the feature boundary.

## Runtime and registration

Process composition creates one evaluator adapter and injects its service into
API and worker contexts. Importing the feature performs no registration.

## Environment and configuration

Evaluator packages do not read environment modules. Runtime composition
validates and injects required configuration.

## Errors

Ordinary evaluator reads throw concrete domain errors. Only named `try*`
discovery methods return `null`.

## Contracts and validation

Zod 4 schemas define portable evaluator inputs and outputs at persistence and
transport boundaries; generated Prisma types remain private.

## Consequences

Evaluator has one contract, one process-owned service and browser-safe reusable
presentation, while application hosts retain routing and transport composition.
