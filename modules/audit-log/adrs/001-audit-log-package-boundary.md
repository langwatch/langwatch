# ADR-001: Audit logging is a portable write capability

**Status:** Accepted

**Behavioural contract:** [Audit logging](../specs/audit-log.feature)

**Placement amended by:** [ADR-134](../../../dev/docs/adr/134-private-prisma-table-ownership.md)
and [ADR-002](./002-audit-log-port-boundary.md). The contract and this
implementation are both core, in `modules/audit-log`.

## Context

Audit writes were implemented as an application helper coupled to the global
Prisma client, Next request objects, and application-only utility modules.

## Decision

Own the portable audit command in a contract package and implement request
normalisation, bounded argument capture, and persistence behind a server class.

## Public surfaces and transports

The contract exports Zod schemas and one callable `AuditLogApi` capability with
its runtime token, and stays in `modules/audit-log/contract`. The
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

The generated module list installs `auditLogServer` in every process; no app
names it. Package imports never create database clients or read runtime
configuration.

The one-shot `agent-audit-log-ids-backfill` task (`tasks/agent-audit-log-ids.task.ts`)
carries main's `scripts/backfill-agent-audit-log-ids.ts`. It writes by default, as the
script did, and `--dry-run` reports without writing. It runs only when an operator
launches it through the tasks process; no API or worker boot runs it. An entry with no
project, or whose window matches more than one agent, is skipped and counted.

Its repository is claimed on `AuditLog` alone: it reads the pre-fix entries and
patches their arguments. The candidate agents come through
`AgentApi.findIdsCreatedInWindow`, main's query carried across the boundary, so the
backfill never reads the Agent table and adds no repair method to AuditLog's API.
Once pre-fix history is repaired, the task and its repository can be removed.

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
