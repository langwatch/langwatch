# ADR-001: Ops owns platform administration and operator capabilities

**Status:** Accepted

**Placement amended by:**
[ADR-112: singular feature ownership](../../../../../dev/docs/adr/112-singular-feature-ownership.md).
The behaviour in this record moves to core `ops`; it is not Enterprise-licensed.

**Behavioural contract:** [Platform administration](../specs/admin.feature)

**Related:** [Impersonation reason](../../../../../specs/features/backoffice-user-impersonation-reason.feature), [Impersonation banner](../../../../../specs/auth/impersonation-banner.feature)

## Context

Platform-admin access, impersonation policy, operator capabilities, and the
process-owned Ops worker loops were spread across app routes, app-layer
services, observability, and several UI locations.

## Decision

Own portable identities, commands, errors, and operator DTOs in the contract
package. Own class-based services and storage adapters in the server package.
Own browser-safe clients, formatters, and reusable controls in the web package.
The server package also owns explicitly started worker contributions for tenant
rate anomaly polling and daily self-hosted usage telemetry. Application worker
composition supplies Redis, Prisma, a ClickHouse client resolver, feature
flags, telemetry/error infrastructure, and validated runtime configuration.
The package constructs its services and owns its Redis, Prisma, and ClickHouse
repositories. Package code reads neither environment nor global application
state.

## Public surfaces and transports

Only package roots are public. The contract exposes Zod 4 DTOs, blob-store
result types, and `OpsService`; the server exposes its composition adapter while
blob-store services/repositories remain private; the web package exposes
`AdminClient`, shared impersonation and JSON-inspection presentation, the
controlled Backoffice list shell, dashboard health/stat presentation, dashboard
axis maths, reusable blob controls, and Foundry trace construction and browser
emission. The application still owns the Hono route, tRPC procedures, page
shells, and app-specific Backoffice and dashboard composition. Foundry receives
the selected project and a named prompt-loading action from a thin app transport
adapter; it imports neither app hooks nor tRPC. Thin app adapters supply the
app's SearchInput, handled-error renderer, page-header create action, and
client-side router link.

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
service. Snapshot collection and dashboard streaming use one process-owned
`OpsSnapshotService`; its Redis adapter owns lease/read/write/version handling.
Scheduler operator controls are part of the canonical `OpsService`. Its private
scheduler collaborator uses the application's scheduled-job store and package
audit and Redis wake adapters. Project labels come from the complete Project
service, not a Project repository owned by Ops. The application registers
Hono/tRPC routes and owns the calendar scheduler loop; package imports do not
register transports.

Anomaly worker construction remains a thin application composition adapter
because the central worker bootstrap is shared and currently composes the
process. The adapter builds the anomaly detector from injected Redis and the
feature-flag service, then starts the package contribution. The usage worker
adapter supplies database and ClickHouse access plus PostHog/fetch
infrastructure; Ops owns the collector and its repositories. Both package
contributions preserve the existing initial scheduling, intervals,
per-organization failure isolation, logs, and shutdown handles.

Dashboard subscriptions yield the current readable snapshot before waiting for
the next update. A missing snapshot remains `null`, preserving the loading
state and the existing SSE response fields.

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
