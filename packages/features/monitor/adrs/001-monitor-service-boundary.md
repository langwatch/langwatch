# ADR-001: Monitor owns monitor CRUD and runtime reads

**Status:** Accepted

**Behavioural contract:** [Monitor service](../specs/monitor-service.feature)

## Context

Monitor persistence and monitor reads are currently split between the
application service and tRPC handlers. The handlers also construct Prisma
repositories per request and duplicate evaluator validation and mapping
normalisation.

## Decision

Create one canonical `MonitorService` contract. It owns tenant-scoped CRUD,
name checks, enabled `ON_MESSAGE` reads, and the monitor reads used by
evaluation and automation callers. Persistence remains private to the server
package.

Create and update validate evaluator ownership through the canonical
`EvaluatorService`. Creation requires an evaluator. Updating an existing
legacy monitor may omit `evaluatorId`; explicitly setting it to `null` is
rejected.

## Boundaries

Portable monitor values and commands use Zod 4. Mappings are normalised at the
service boundary so `{}`, null, undefined, and malformed legacy values become
`{ mapping: {}, expansions: [] }`. Project IDs are part of every lookup and
mutation input and are applied to every repository predicate.

The package does not own performance analytics or evaluator/workflow copying.
Those operations require their existing dedicated services and remain
compatibility-router seams until those services expose the required commands.

## Contracts and validation

Monitor commands, values, mapping normalisation and domain errors are defined
in the contract package with Zod 4. The service parses every command before
calling its repository and throws on missing monitor reads; nullable runtime
lookups use the explicit `tryGetMonitorById` name.

## Dependencies

Monitor consumes only the canonical Evaluator service for evaluator ownership
validation. It does not import evaluator repositories, Prisma models, or
evaluation persistence. Performance remains owned by the existing evaluation
analytics capability.

## Persistence

`PrismaMonitorRepository` is private to the server package and scopes every
read and mutation by project ID. The adapter receives the process database
connection once at boot.

## Runtime

The process creates one `PostgresMonitorAdapter` and injects the canonical
Evaluator service and database at boot. API and worker callers receive only
`MonitorService`; they do not construct Prisma or repositories per request.

## Public surfaces and transports

Existing tRPC and REST routes keep their current URLs and procedure names.
They will become thin compatibility handlers over `MonitorService` in the
composition integration. This package does not register routes.

## Runtime and registration

The parent App composition creates one `PostgresMonitorAdapter` and supplies
the resulting service through App/context. No request handler constructs a
repository or Prisma adapter.

## Environment and configuration

The feature reads no environment variables. ID generation is injected at
composition time, with a local fallback only for standalone tests.

## Errors

`MonitorNotFoundError` is thrown for required reads.
`MonitorEvaluatorRequiredError` is thrown when creation omits an evaluator or
an update explicitly removes one. Evaluator ownership failures remain the
canonical Evaluator service error.

## Consequences

All monitor callers can share the same tenant-scoped behavior and validation.
Legacy URL/procedure shapes remain unchanged while their handlers migrate to
the service. Performance and copy flows are explicit follow-up integrations,
not speculative methods on Monitor.
