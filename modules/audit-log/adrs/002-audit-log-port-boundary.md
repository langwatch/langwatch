# ADR-002: The audit log is a port every process answers

**Status:** Accepted

**Behavioural contract:** [The audit log port](../specs/audit-log-port.feature)

## Context

Sixteen call sites across nine packages wrote and read the shared `AuditLog`
table through their own Prisma clients, so a deployment could not decide what
was recorded, and no process could answer "which audit log is this".

## Decision

`AuditLogApi` stays a portable contract in this package. The implementation is
Enterprise and lives in `enterprise/modules/audit-log/server`. An
installation without it installs `@langwatch/audit-log-null` under the same
token. A process installs exactly one of the two.

## Public surfaces and transports

The contract exports one callable capability with two operations —
`record(command)` and `listEntityHistory(input)` — its `moduleApi` token, and
the Zod schemas both carry. There is no transport: the feature answers other
features through the token, and the audit surfaces a customer reads are the
organization package's own tRPC and REST doors.

## Dependencies

Zod 4 and `moduleApi` from `@langwatch/runtime-composition`, and nothing else. The
package is browser-safe and Apache-licensed, so an OSS feature may depend on the
capability without depending on the Enterprise implementation.

## Persistence

None. The contract owns no table, no client and no repository; the Enterprise
server owns the `AuditLog` reads and writes behind `AuditLogRepository`, and the
null implementation owns nothing at all.

## Runtime and registration

`apps/api` and `apps/worker` install `auditLogNullServer`. A deployment with the
Enterprise composition installs `auditLogServer` through
`EnterpriseApiAuditLog` or `EnterpriseWorkerAuditLog` instead. Boot fails by
name when a feature that depends on `AuditLogApi` finds neither installed.

## Environment and configuration

The contract reads no environment variable and takes no configuration. The
Enterprise implementation's argument byte limit is its own feature config.

## Errors

An invalid command fails Zod validation at the boundary and throws. Neither
implementation carries a `HandledError`: a caller records as a side effect of an
act it has already authorized, and has no remedial action to offer.

## Contracts and validation

Audit identifiers and actions are non-empty strings, optional request metadata
is portable, and argument and metadata payloads must be JSON-compatible values.

## Consequences

An OSS installation records no audit history, and every surface that renders
history shows an empty list rather than failing.

Writes the two operations cannot express — a row inside another feature's
transaction, a governance diff in `before`/`after`, an idempotent insert keyed
on a caller-supplied id — still write the table directly. Widening the port for
them is a separate decision.
