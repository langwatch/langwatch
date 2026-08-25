# ADR-001: Evaluator is a contract and server feature

**Date:** 2026-08-24

**Status:** Accepted

**Behavioural contract:** [Evaluator package boundary](../specs/evaluator-service.feature)

**Related:** [ADR-101: feature package surfaces](../../../../dev/docs/adr/101-feature-package-surfaces.md), [strict feature layout](../../../architecture-lint/adrs/002-versioned-strict-feature-layout.md)

## Context

Evaluator definitions, configuration, workflow field enrichment, lifecycle
operations and copy synchronization were previously implemented beside the
application's API adapters. That made the REST and tRPC callers responsible
for constructing persistence-backed services and made the evaluator vocabulary
depend on Prisma-shaped records.

## Decision

The Evaluator ownership root provides a portable contract, one process-owned
server implementation, and browser-safe reusable UI. The contract owns Zod 4
schemas, definitions, domain errors and the abstract service capability. The
server owns the service, private repository and the Postgres adapter. The web
package owns evaluator category/type pickers, evaluator-card presentation, and
pure authoring guidance. The application composes one
`PostgresEvaluatorAdapter` instance and supplies its contract through App;
request handlers delegate to that instance.

The contract also owns the built-in evaluator catalogue, code-evaluator
configuration and editor defaults, and evaluator display names. Evaluation
execution remains owned by the Evaluation feature; its separate migration must
consume an evaluator through the canonical service rather than query evaluator
persistence.

Existing REST and tRPC URLs remain compatibility adapters. They may preserve
their response envelopes and authorization, but they do not construct an
Evaluator service or access its repository. Workflow field lookup uses the
canonical Workflow service contract. Prisma imports remain private to
`server/src/repositories/prisma`.

## Contracts and validation

The contract exports Zod 4 schemas and inferred transport-safe values. The
server validates inputs before persistence and maps database rows at the
repository edge.

## Persistence

The private repository is the persistence port. Its Postgres implementation is
private to the server package and is composed once by the adapter.

## Dependencies

Evaluator uses only its repository, the canonical Workflow service contract,
and an injected audit-log capability. It does not import another feature's
server implementation or define a duplicate Workflow port.

## Runtime and registration

The process composition root registers one adapter on App. Request context
passes through that App instance; no request constructs a service or recovers a
global application.

## Public surfaces and transports

Existing REST and tRPC routes remain compatibility adapters over the contract
service. Their URLs and authorization semantics are unchanged by this
extraction.

`@langwatch/evaluator-web` has one root export. It accepts callback and
availability ports from its host and uses `@langwatch/evaluator-contract` as
its sole domain vocabulary. It never imports app aliases, tRPC, router state,
or the Evaluator server. App wrappers retain drawer-stack routing, availability
queries, API-usage code snippets, Langy context, relative-time formatting, and
copy/cascade composition.

## Environment and configuration

Evaluator receives resolved model defaults from the composition root. It does
not read environment variables during module import.

## Errors

Missing values, invalid types, copy selection and source synchronization
failures use typed handled domain errors. Nullable discovery is explicitly
named `try*`; ordinary service methods throw.

## Consequences

Evaluator behaviour has one service boundary while transports can evolve
independently. Existing clients keep their URLs and response behaviour during
the extraction. Persistence and transport types cannot leak through the
contract, and composition tests can replace persistence and canonical service
dependencies.

This decision does not move pages, workflow ownership, availability transport,
or unrelated optimization orchestration into the Evaluator package.
