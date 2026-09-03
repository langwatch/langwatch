# ADR-001: Monitor owns monitor lifecycle and runtime reads

**Status:** Accepted

**Behavioural contract:** [Monitor service](../specs/monitor-service.feature)

## Context

Monitor persistence and monitor reads previously leaked into compatibility
handlers, including monitor replication. That duplicated tenant scoping, name
de-duplication, mapping normalisation, and the safe disabled initial state.

## Decision

Create one canonical `MonitorService` contract. It owns tenant-scoped CRUD,
replication, name checks, enabled `ON_MESSAGE` reads, and the monitor reads
used by evaluation and automation callers. Persistence remains private to the
server package.

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
Performance analytics belongs to the evaluation analytics capability. An
Evaluator-backed monitor copy first copies the evaluator through the canonical
Evaluator service; Monitor then persists the disabled replica with that new
evaluator id. The package's tRPC transport sequences the cross-feature rollback
— archive the copied evaluator, then remove its workflow — but the workflow
copy and its removal are process-supplied ports, because the studio DSL and its
version history belong to the Workflow feature.

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
Evaluator service, database, and KSUID generator at boot. API and worker
callers receive only `MonitorService`; they do not construct Prisma or
repositories per request.

## Public surfaces and transports

Existing tRPC and REST routes keep their current URLs and procedure names. The
tRPC surface is package-owned: `MonitorTrpcApi.create` installs the nine
`monitors.*` procedures on a root the process supplies, and the process injects
its own authenticated procedure plus the authorization, audit, error, logging
and tracing chain. That chain is applied AFTER each procedure's `.input()`,
because the declared permission check reads its scope id from the validated
input. The REST routes remain thin process handlers over `MonitorService`. This
package registers nothing on import.

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
Legacy URL/procedure shapes remain unchanged. Performance remains a separate
evaluation read model; monitor replication now has one owner.
