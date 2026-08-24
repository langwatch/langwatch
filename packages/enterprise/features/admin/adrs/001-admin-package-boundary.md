# ADR-001: Platform-admin policy is explicitly composed

**Status:** Accepted

**Behavioural contract:** [Enterprise platform administration](../specs/admin.feature)

**Related:** [Impersonation reason](../../../../../specs/features/backoffice-user-impersonation-reason.feature), [Impersonation banner](../../../../../specs/auth/impersonation-banner.feature)

## Context

Platform-admin access, impersonation policy, Prisma writes, Hono routes, and
Backoffice React code previously shared an application `ee/admin` directory.

## Decision

Own portable identities, commands, and errors in a contract package. Own
class-based access, impersonation, and Prisma adapters in a server package.
Own the browser transport client and portable banner in a web package.

## Public surfaces and transports

Only package roots are public. Contracts expose Zod 4 DTOs and abstract access;
server exposes class services/adapters; web exposes `AdminClient` and the banner.
The application still owns Hono route and app-specific Backoffice views.

## Dependencies

Contract depends on handled errors and Zod 4. Server depends on contract and
generated Prisma only inside `repositories/prisma`. Web is browser-safe and
depends on contract, React, and Chakra UI.

## Persistence

`PrismaImpersonationRepository` owns session JSON mutation. Admin list queries
remain inside the application Hono adapter until the generic data-provider
surface is replaced with purpose-built repository methods.

## Runtime and registration

`PostgresAdminAdapter.create(...).build()` constructs access and impersonation
services. The application registers Hono routes; package imports do not.

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
