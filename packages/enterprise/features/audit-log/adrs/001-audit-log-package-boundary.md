# ADR-001: Audit logging is a portable write capability

**Status:** Accepted

**Behavioural contract:** [Enterprise audit logging](../specs/audit-log.feature)

## Context

Audit writes were implemented as an application helper coupled to the global
Prisma client, Next request objects, and application-only utility modules.

## Decision

Own the portable audit command in a contract package and implement request
normalisation, bounded argument capture, and persistence behind a server class.

## Public surfaces and transports

The contract exports Zod schemas and one abstract `AuditLogService` capability.
The server exports class implementations plus a compatibility function for
existing application callers; HTTP and RPC transports remain application-owned.

## Dependencies

The contract depends only on Zod 4. The server depends on its contract and has
no application, environment, transport, or generated database dependency.

## Persistence

`AuditLogRepository` is the private persistence port. A structural Prisma
adapter lives only in the server repository directory and maps portable data.

## Runtime and registration

Composition constructs and explicitly installs the process audit service.
Package imports never create database clients or read runtime configuration.

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
