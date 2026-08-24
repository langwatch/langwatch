# ADR-001: SCIM contracts and credentials are transport-neutral

**Status:** Accepted

**Behavioural contract:** [Enterprise SCIM](../specs/scim.feature)

**Related:** [SCIM group mapping](../../../../../specs/features/scim-group-mapping.feature), [SCIM token REST API](../../../../../specs/organizations/scim-tokens-rest-api.feature)

## Context

SCIM resource schemas, token hashing, plan checks, Prisma calls, Hono routes,
and product provisioning were coupled in the application Enterprise tree.

## Decision

Own SCIM v2 resource contracts and role resolution in a contract package. Own
credential hashing, entitlement-aware verification, Postgres token persistence,
and OpenAPI metadata in a server package. Product provisioning remains an app
composition concern until its core services have portable ports.

## Public surfaces and transports

The contract exposes Zod 4 resource schemas, DTOs, errors, and role helpers.
The server exposes class token services/adapters and OpenAPI operation metadata;
the application owns Hono route registration.

## Dependencies

The contract depends on handled errors and Zod 4. The server depends on the
contract, Node crypto, and Hono OpenAPI types only.

## Persistence

`PrismaScimTokenRepository` is the only token persistence adapter and consumes
an injected structural database capability.

## Runtime and registration

`PostgresScimTokenAdapter.create(...).build()` constructs a service. Packages
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

REST, RPC, and worker callers may reuse credential semantics without importing
the app, while Hono provisioning continues to compose app-owned dependencies.
