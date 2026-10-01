# ADR-001: SCIM contracts and credentials are transport-neutral

**Status:** Accepted

**Behavioural contract:** [Enterprise SCIM](../specs/scim.feature)

**Related:** [SCIM group mapping](../../../../../specs/features/scim-group-mapping.feature), [SCIM token REST API](../../../../../specs/organizations/scim-tokens-rest-api.feature)

## Context

SCIM resource schemas, token hashing, plan checks, Prisma calls, Hono routes,
and product provisioning were coupled in the application Enterprise tree.

## Decision

Own SCIM v2 resource contracts and role resolution in a contract package. Own
one abstract `ScimService` that owns both provisioning and credential lifecycle.
The server package provides its Postgres composition and OpenAPI metadata; the
application composes it once with UserService, AuthService, GovernanceService,
AuthzGrantsService, and plans.

## Public surfaces and transports

The contract exposes Zod 4 resource schemas, DTOs, errors, and role helpers.
The server exposes only `PostgresScimAdapter` and OpenAPI operation metadata;
the application owns thin Hono route registration.

## Dependencies

The contract depends on handled errors and Zod 4. The server depends on the
contract, GovernanceService, UserService, AuthService, AuthzGrantsService, and
Node crypto. SCIM PUT and PATCH persist a materially changed email through User
before calling Auth to revoke browser sessions.
Hono OpenAPI types stay in the transport adapter.

## Persistence

`PrismaScimRepository` is the only persistence adapter and consumes the
generated Prisma client directly.

## Runtime and registration

`PostgresScimAdapter.create(...).build()` constructs the singular service. Packages
perform no route registration, global mutation, or connection at import time.

## Environment and configuration

Packages read no environment. Application composition supplies the database
and the current plan entitlement provider.

## Errors

Unknown or cross-organization revocations retain the stable token-not-found
error. Verification distinguishes invalid credentials from lapsed entitlement.

## Contracts and validation

All SCIM payload schemas run on Zod 4 and retain RFC-compatible wire names and
schema URNs.

## Consequences

REST, RPC, webhook, and provisioning callers reuse the process-owned service
from request App context; no transport creates a service or accesses Prisma.
