# ADR-001: Data Retention service boundary

**Status:** Accepted

**Behavioural contract:** [Data Retention service boundary](../specs/data-retention-service.feature)

## Context

Retention policy, trace pins, settings UI, and retroactive work were split
across application folders. Policy reads also duplicated scope traversal.

## Decision

Data Retention is one core feature with contract, server, and web surfaces.
Its service owns policy cascade, policy persistence, caching, trace pins, and
retroactive retention mutations.

## Public surfaces and transports

The contract exports Zod 4 values, errors, and one `DataRetentionService`.
The web package exports reusable transport-free settings presentation. App
tRPC and pages remain compatibility composition until the physical app split.
Metering is a private collaborator of the feature service. The app retains only
the RBAC-aware scope read composition and its live ClickHouse integration
harness until the physical app split. The feature server owns the ClickHouse
table catalogue.

## Dependencies

The server receives complete Project and Organization services plus its own
private repositories and cache. Share owns active-link unpin policy and then
delegates pin removal here.

## Persistence

Private Prisma repositories own retention-policy rows and pin annotations.
Pinning never changes retention stamps or ClickHouse TTLs.

## Runtime and registration

Boot composes one service per process. A private ClickHouse repository receives
the tenant-aware client resolver; unavailable ClickHouse preserves the existing
trigger error, empty progress, and no-op cancellation behaviour.

## Environment and configuration

Boot validates and injects the platform default and cache settings. Feature
modules do not read environment state.

## Errors

Ordinary methods return a value or throw. Reads of a missing project resolve
to the injected platform default; writes to missing scope targets throw
`ScopeTargetNotFoundError` or the canonical dependency error.

## Contracts and validation

Contract schemas validate categories, scopes, retention days, policies, and
pin inputs at service, transport, and persistence boundaries.

## Consequences

Policy resolution is project, team, then organization, most-specific first,
with the platform default last. Writes invalidate every affected project.
Reusable UI has one owner; app code retains only transport and page composition.
