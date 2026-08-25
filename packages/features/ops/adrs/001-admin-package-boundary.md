# ADR-001: Ops owns platform administration and operator capabilities

**Status:** Accepted

**Placement amended by:**
[ADR-112: singular feature ownership](../../../../../dev/docs/adr/112-singular-feature-ownership.md).
The behaviour in this record moves to core `ops`; it is not Enterprise-licensed.

**Behavioural contract:** [Platform administration](../specs/admin.feature)

**Related:** [Impersonation reason](../../../../../specs/features/backoffice-user-impersonation-reason.feature), [Impersonation banner](../../../../../specs/auth/impersonation-banner.feature)

## Context

Platform-admin access, impersonation policy, and operator capabilities were
spread across app routes, app-layer services, and several UI locations.

## Decision

Own portable identities, commands, errors, and operator DTOs in the contract
package. Own class-based services and storage adapters in the server package.
Own browser-safe clients, formatters, and reusable controls in the web package.

## Public surfaces and transports

Only package roots are public. The contract exposes Zod 4 DTOs, blob-store
result types, and `OpsService`; the server exposes its composition adapter while
blob-store services/repositories remain private; the web package exposes
`AdminClient`, shared impersonation and JSON-inspection presentation, and
reusable blob controls. The application still owns the Hono route, tRPC
procedures, page shells, and app-specific Backoffice view composition.

## Dependencies

Contract depends on handled errors and Zod 4. Server depends on contract and
generated Prisma only inside `repositories/prisma`; Redis and group-queue
access stays in the private Redis repository. Web is browser-safe and depends
on contract, React, and Chakra UI.

## Persistence

`PrismaImpersonationRepository` owns session JSON mutation. The private Ops
backoffice repository owns the compatibility data-provider operations,
safe-selects, search predicates, and CRUD. Blob listing and cleanup persistence
is owned by the private Redis repository.

## Runtime and registration

`PostgresOpsAdapter.create(...).build()` constructs the process-owned Ops
service. The application registers Hono routes; package imports do not.

## Environment and configuration

Packages read no environment. Application composition supplies the configured
admin email allow-list through `AdminAccess`.

## Errors

Missing, deactivated, and admin impersonation targets retain stable handled
error codes and statuses. The app route continues hiding the admin surface.

## Contracts and validation

Admin identities and impersonation inputs use portable Zod 4 schemas. Existing
Backoffice wire resource and sort names remain stable.

## Consequences

Admin policy and browser transport can be reused by future API composition,
while app-owned auth/session and view dependencies remain at the app edge.
