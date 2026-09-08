# ADR-001: Monitor owns monitor lifecycle and runtime reads

**Status:** Accepted

**Behavioural contract:** [Monitor service](../specs/monitor-service.feature),
[Catalogue seam](../specs/monitor-catalog-seam.feature)

## Context

Monitor persistence and monitor reads previously leaked into compatibility
handlers, including monitor replication. That duplicated tenant scoping, name
de-duplication, mapping normalisation, and the safe disabled initial state.

## Decision

Create one callable `MonitorApi`. It owns tenant-scoped CRUD, replication, name
checks, enabled `ON_MESSAGE` reads, the seven-day trend, and the monitor reads
evaluation, automation and gateway callers make. Persistence stays private to
the server package, selected by `defineRepositories` rather than by an adapter
the process builds.

Create and update validate evaluator ownership through the evaluator the
process supplies. Creation requires an evaluator. Updating an existing legacy
monitor may omit `evaluatorId`; explicitly setting it to `null` is rejected.

## Boundaries

Portable monitor values and commands use Zod 4. Mappings are normalised at the
service boundary so `{}`, null, undefined, and malformed legacy values become
`{ mapping: {}, expansions: [] }`. Project IDs are part of every lookup and
mutation input and are applied to every repository predicate.

The package does not own performance analytics or evaluator/workflow copying.
The trend is read through `MonitorPerformancePort`, whose ClickHouse client and
comparison window the process composes. An evaluator-backed monitor copy first
copies the evaluator through `MonitorReplicationPort`; Monitor then persists the
disabled replica with that new evaluator id. The application sequences the
cross-feature rollback — archive the copied evaluator, then remove its workflow
— because it is a statement about what two projects hold, and a second door
writing its own copy would be a second chance to leave an orphan behind.

## Contracts and validation

Monitor commands, values, mapping normalisation and domain errors are defined
in the contract package with Zod 4. The service parses every command before
calling its repository and throws `MonitorNotFoundError` on a required read;
the one lookup whose absence is a normal answer is `findById`, which answers
`undefined`.

## Dependencies

`AuthzApi` is the one peer, and it answers the two questions a declared check
cannot: standing in the project a monitor is copied FROM, and the second
permission the trend needs. Everything else the process supplies as a technical
port — the evaluator, the trend, the evaluator copy, and the id generator. The
evaluator is a port rather than the `EvaluatorApi` token only until that token
publishes a lookup by id.

## Persistence

`PrismaMonitorRepository` and `MemoryMonitorRepository` are the two backends
behind `MonitorRepository`, registered by
`repositories/monitor-repositories.registry.ts` and selected by the process's
`withPersistence`. Both scope every read and mutation by project id, both
canonicalise mappings on the way out, and both refuse a write naming a monitor
the project does not hold with `MonitorNotFoundError`. That equivalence is
proven by `repositories/__tests__/monitor.repository.contract.test.ts`, which
runs one set of cases against both.

## Runtime and registration

The process boots `monitorServer` through `createApp(...).withFeature(...)` and
reads `MonitorApi` back off the runtime, handing the four technical ports in as
that feature's infrastructure. API and worker callers receive that one object;
no request handler constructs a repository or a Prisma client, and this package
registers nothing on import.

## Public surfaces and transports

Existing tRPC and REST routes keep their current URLs and procedure names. The
`monitors.*` procedures are declared once in `contract/src/monitor.trpc.ts` and
bound in `server/src/transport/monitor.trpc.ts`; `/api/monitors` is declared in
`server/src/transport/monitor.rest.ts`. Each is an inert declaration the process
mounts on its own runtime, so the authorization, audit, error, logging and
tracing chain is the process's and is applied once, after the declared parser.
This package registers nothing on import.

## Environment and configuration

The feature reads no environment variables. ID generation is injected at
composition time.

## Errors

`MonitorNotFoundError` (404) is thrown for required reads and for a write
naming a monitor the project does not hold. `MonitorEvaluatorRequiredError`
(400) is thrown when creation omits an evaluator or an update explicitly
removes one. `MonitorCheckTypeUnknownError` and
`MonitorCheckSettingsInvalidError` (both 400) refuse a check that cannot run.
`MonitorSourceProjectForbiddenError` (403) refuses a copy out of a project the
caller cannot manage. Evaluator ownership failures remain the evaluator
feature's own error.

## Consequences

All monitor callers share the same tenant-scoped behaviour and validation.
Legacy URLs and procedure names are unchanged; the published document's
operation ids change, because the runtime derives them from each route's
declared operation rather than from its path. Performance remains a separate
evaluation read model, and monitor replication has one owner. A toggle or a
delete naming a monitor the project does not hold now answers 404 on both
doors, where the tRPC one used to answer 500.
