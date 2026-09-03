# ADR-001: API Key service boundary

**Status:** Accepted

**Behavioural contract:** [API Key lifecycle](../specs/api-key.feature)

## Context

API-key lifecycle behavior previously lived in application services, CLI
helpers, authentication middleware, and caller-owned Prisma repositories.
That allowed issuance, verification, grant replacement, and device-key cleanup
to drift even though they operate on one credential aggregate.

## Decision

API credentials have one contract and one process-owned service. The service
owns issuance, bearer verification, hash upgrades, restriction, grant
replacement, ingestion-key discovery, CLI device-key lifecycle, enrichment,
and revocation. Transports delegate to it rather than reimplementing those
rules.

Authentication is an attempted lookup and is named `tryVerify`; other nullable
reads are likewise explicitly named `try*`. Mutations either complete or
throw. A newly minted key is born revoked, its private role and grants are
attached first, and it is activated last. A replacement attaches the new grant
set before revoking the old set.

### Target selection compatibility

A deprecated project credential remains bound to the project resolved from its
token: a Basic-auth project id or `X-Project-Id` does not replace that target.
A current API key accepts a selected project in its own organization, with its
scope and permission ceiling checked at the route boundary. Organization-token
resolution does not inspect a project target. These existing wire semantics are
characterised in the server tests; stricter target validation needs its own
compatibility decision rather than a migration-side behaviour change.

### Public surfaces and transports

The contract exports portable Zod 4 values, API-key errors, and the one
abstract `ApiKeyService`. Existing REST, tRPC, CLI, OTLP, and internal callers
remain compatibility transports and delegate to the service on App context.

### Dependencies

The implementation receives canonical AuthZ, Organization, and Project
services. It receives only its own private API-key repository and token
algorithm port; the PostgreSQL adapter composes the pepper-backed token
adapter. It never receives a foreign repository or a user repository. User
enrichment reads the canonical AuthZ projection.

### Persistence

API-key persistence is owned by the server package's private Prisma repository.
Grant facts are written through `AuthzGrantsService`; no caller updates API-key
role bindings directly.

### Runtime and registration

Boot constructs one API-key service after its canonical collaborators and
stores it on the process-owned App. Hono uses `c.var.langwatchApp.apiKeys`,
tRPC uses `ctx.app.apiKeys`, and no request constructs a service.

### Environment and configuration

The feature reads no environment at import time. Boot validates and injects
the credential pepper when it constructs the PostgreSQL adapter.

### Errors

Mutations and required reads throw API-key contract errors. Authentication and
genuinely optional reads return `null` only through methods named `try*`.

### Contracts and validation

Cross-feature and transport values use Zod 4 schemas from the contract root.
The contract contains no Prisma, Node, transport, environment, or application
imports.

## Consequences

Credential semantics have one implementation. Compatibility transports retain
their existing URLs and response shapes while construction and persistence
remain confined to boot and the feature server package.
