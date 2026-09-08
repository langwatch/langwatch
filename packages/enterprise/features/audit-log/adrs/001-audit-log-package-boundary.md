# ADR-001: Audit logging is a portable write capability

**Status:** Accepted

**Behavioural contract:** [Audit logging](../specs/audit-log.feature)

**Placement amended by:** [ADR-134](../../../../../dev/docs/adr/134-private-prisma-table-ownership.md)
and [ADR-002](../../../../features/audit-log/adrs/002-audit-log-port-boundary.md). The
contract is a core port; this implementation is Enterprise.

## Context

Audit writes were implemented as an application helper coupled to the global
Prisma client, Next request objects, and application-only utility modules.

## Decision

Own the portable audit command in a contract package and implement request
normalisation, bounded argument capture, and persistence behind a server class.

## Public surfaces and transports

The contract exports Zod schemas and one callable `AuditLogApi` capability with
its runtime token, and stays in `packages/features/audit-log/contract`. The
server owns `AuditLogApp` and its bounded writer service; HTTP and RPC
transports remain application-owned. Entity history reads use `AuditLogApi.listEntityHistory`,
scoped to a project, action prefix and explicit argument keys. The caller owns
user enrichment; audit persistence never reads User rows. Organization-wide
governance history remains a separate migration.

## Dependencies

The contract uses Zod 4 and the portable API token. The server uses runtime
composition and Prisma ownership metadata; it has no application, environment
or transport dependency. Generated database types stay out of the public API.

## Persistence

`AuditLogRepository` is the private persistence interface, with a Prisma and a
memory backend selected by `defineRepositories`. Prisma is named only inside
`repositories/prisma/`.

## Runtime and registration

Composition installs the process audit app through `auditLogServer`; an
installation without this package installs `@langwatch/audit-log-null` under the
same token instead. A process installs exactly one of the two. Package imports never create database clients or read runtime
configuration.

The explicit `agent-audit-log-ids-backfill` task previews historical repairs by
default. With `--execute`, it registers the project-rooted
`AgentAuditLogIdsMigration` with the system migration runner. Redis leases and
durable tenant checkpoints govern execution; no API or worker boot registers
this repair automatically. Ambiguous matches hold the project for inspection.

Its private migration repository receives a runtime capability for `AuditLog`
and `Agent` only: it reads timestamp/source-copy candidates from Agent and
patches AuditLog arguments. This historical exception grants no Agent table
ownership to AuditLog and adds no repair method to either feature's public API.
Once pre-fix history is repaired, the explicit task and migration can be removed.

## Environment and configuration

The feature reads no environment variables. Its argument byte limit and the
clock, when needed by future implementations, are explicit configuration.

## Errors

Invalid commands fail Zod validation. Invoking the compatibility function
before composition installs a service fails with a named configuration error.

## Contracts and validation

Audit identifiers and actions are non-empty, optional request metadata is
portable, and argument and metadata payloads must be JSON-compatible values.

## Consequences

API, worker, and application callers share one write contract while request
framework details and the Prisma lifecycle remain outside the feature boundary.
