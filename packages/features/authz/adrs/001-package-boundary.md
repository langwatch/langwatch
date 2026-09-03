# ADR-001: AuthZ is a contract and server feature

**Date:** 2026-08-23

**Status:** Accepted

**Behavioural contract:**
[AuthZ package boundary](../specs/package-boundary.feature)

**Related:**
[ADR-092: unified authorization engine](../../../../dev/docs/adr/092-unified-authorization-engine.md),
[ADR-110: grant aggregates are grants](../../../../dev/docs/adr/110-grant-aggregates-are-grants.md),
[ADR-101: feature package surfaces](../../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-103: Standard Schema API boundaries](../../../../dev/docs/adr/103-standard-schema-api-boundary.md),
[ADR-104: runtime environment configuration](../../../../dev/docs/adr/104-runtime-environment-configuration.md),
[feature package boundaries](../../../architecture-lint/adrs/001-feature-package-boundaries.md),
[strict feature source layout](../../../architecture-lint/adrs/002-versioned-strict-feature-layout.md),
[runtime composition roots](../../../../dev/docs/adr/102-runtime-composition-roots.md),
[shared runtime configuration](../../../config/adrs/001-shared-runtime-configuration.md),
[the Eventing framework boundary](../../../eventing/adrs/20260820-eventing-framework-boundary.md),
[projection replay coordination](../../../eventing/adrs/015-projection-replay-coordination.md),
[Redis as an owned client](../../../../dev/docs/adr/093-redis-is-an-owned-client.md),
[the system-migration runner](../../../../specs/migration/system-migrations-runner.feature),
[typed permission declarations](../../../../specs/rbac/typed-permission-declarations.feature),
[unified authorization behaviour](../../../../specs/rbac/unified-authorization-engine.feature),
[authorization grants](../../../../specs/rbac/authz-grants.feature),
and [authorization migration](../../../../specs/migration/authz-grants-rollout.feature).

## Context

AuthZ predates the strict feature layout. Its portable vocabulary and pure
decision engine live in `packages/authz`, its services and repository
interfaces live in `packages/authz-server`, and most concrete persistence,
Eventing, migration, cache and composition code lives below
`platform/app/src/server/app-layer/authz` or the application's event-sourcing
tree.

The split is conceptually close to the new feature model, but it is not sealed.
The contract package has the old package name, no Zod 4 schema boundary and no
abstract service capability. Server services sit at the source root, use
public constructors and expose private repository vocabulary. Ordinary app
modules import the server package directly. Prisma repositories and the AuthZ
pipeline sit outside the feature, and free factories still register runtime
behaviour.

This move is structural. ADR-092 and ADR-110 remain the authority for
permission semantics, grant identity, the owner ceiling, the append-only
registry, Eventing behaviour and rollout. The move must not create a new
authorization model while trying to give the existing one a proper home.

This ADR supersedes ADR-092 only where that older decision fixes the package
name as `@langwatch/authz` or requires Prisma implementations to remain in the
application. ADR-092 remains authoritative everywhere else and receives a
matching scoped amendment as part of this decision.

## Decision

Move AuthZ under one layout-version-0 feature root and remove the two old
package roots:

```text
packages/features/authz/
├── feature.json
├── contract/                         # @langwatch/authz-contract
│   ├── src/
│   │   ├── index.ts
│   │   ├── authz.ts                 # portable vocabulary and schemas
│   │   ├── authz.commands.ts
│   │   ├── authz.queries.ts
│   │   ├── authz.errors.ts
│   │   ├── authz.service.ts         # abstract decision/read capability
│   │   ├── authz-grant.events.ts    # portable event payload schemas
│   │   ├── authz-grants.service.ts  # abstract mutation capability
│   │   └── <pure domain files>
│   └── tests/
├── server/                           # @langwatch/authz-server
│   ├── src/
│   │   ├── index.ts
│   │   ├── testing.ts
│   │   ├── services/
│   │   │   ├── authz.service.ts
│   │   │   ├── authz-collector.service.ts
│   │   │   └── authz-grants.service.ts
│   │   ├── repositories/
│   │   │   ├── authz-read.repository.ts
│   │   │   ├── authz-listing.repository.ts
│   │   │   ├── authz-grant.repository.ts
│   │   │   ├── authz-migration.repository.ts
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.authz.mapper.ts
│   │   │   │   ├── prisma.authz-read.repository.ts
│   │   │   │   ├── prisma.authz-grant.repository.ts
│   │   │   │   └── prisma.authz-migration.repository.ts
│   │   │   ├── routed/
│   │   │   │   └── routed.authz-read.repository.ts
│   │   │   └── eventing/
│   │   │       └── eventing.authz-grant.repository.ts
│   │   ├── ports/
│   │   │   └── authz-epoch.port.ts
│   │   ├── adapters/
│   │   │   ├── eventing.authz-audit.adapter.ts
│   │   │   ├── eventing.authz.adapter.ts
│   │   │   └── redis.authz-epoch.adapter.ts
│   │   ├── projections/
│   │   │   └── authz-grant.projection.ts
│   │   └── migrations/
│   │       └── legacy-import.authz-grant.migration.ts
│   └── tests/
├── adrs/
└── specs/
```

There is no AuthZ web package in this change. `useCan`, `RequireCan` and
settings UI remain app-owned browser adapters over the portable contract.
They can move into a web package later if AuthZ gains an independently reusable
browser surface.

The package rename is deliberate. Every consumer moves from
`@langwatch/authz` to `@langwatch/authz-contract` in the same change. No alias,
compatibility package or forwarding export remains because this code is still
in progress and the old name conflicts with the enforced package grammar.

### Keep two public capabilities

The contract exposes two abstract service classes:

- `AuthzService` owns permission checks, explanations, effective permissions,
  scope resolution and access-listing queries. Its transitional `isOnEngine`
  query lets compatibility adapters choose a read authority without exposing
  the routing gate.
- `AuthzGrantsService` owns attach, change, revoke, replace and offboard
  commands. The existing low-level binding, resource-grant and role-definition
  write verbs remain methods on this same capability so legacy callers retain
  their exact batching, actor, ID and ordering semantics without a third public
  ledger service.

The current `AuthzCollectorService` is not a third public capability. It stays
as a private concrete service class behind `AuthzService`, preserving its
collection, resource-grant and one-pass read behaviour without turning the
public service into one enormous file. Existing access-listing repositories
also become private inputs to `AuthzService` instead of being constructed
throughout API key, group, role and team code.

The concrete services extend their contract classes, expose `static create`
and receive abstract class repositories and ports. There are no service
factories, global singleton modules or alternate lifecycle/composition layers.

### Contracts and validation

The contract remains browser-safe and owns Zod 4 schemas for principals,
scopes, permissions, decisions, grant commands, grant and role event payloads,
errors and service inputs and outputs. TypeScript transport types are inferred
from those schemas. The append-only permission registry remains the source of
the `AuthzPermission` union and keeps its current order exactly.

The contract does not import Node, Prisma, Eventing, Redis, Hono, tRPC server
code or application aliases. Event payload schemas describe portable payloads,
not Eventing envelopes. The server's Eventing adapter combines those payloads
with the framework envelope and command handlers.

The contract has one root export. The old `@langwatch/authz/witness` subpath is
removed. `Authorized` remains a portable opaque type, while witness minting
stays private to the concrete server service. Callers obtain a witness through
`AuthzService.authorize`; they cannot mint one through a public package
subpath.

Concrete handled errors currently needed by consumers, including permission
denial, invalid grants, duplicate grants, missing bindings and incomplete
offboarding, move to the contract. Infrastructure failures remain server
errors and do not expose Prisma, Redis or Eventing details.

### Persistence

This move adds no table and changes no persisted event name, aggregate key,
idempotency key, projection row or migration status. Existing `Grant`, `Role`,
legacy compatibility, audit and system-migration state remain authoritative as
defined by ADR-092 and ADR-110. Grant and role entities keep distinct grant or
role aggregate IDs while sharing the existing `authz_grant` pipeline aggregate
type.

Repository ports are abstract classes inside the server package. Concrete
Prisma-compatible classes receive a structural database capability from the
runtime and map rows before returning contract values. Generated Prisma types
never cross the package boundary. The legacy and projected read heads are
selected by one routed repository using the existing per-organization
migration-state gate.

Grant writes continue through Eventing for migrated organizations and through
the existing compatibility path for organizations that have not migrated. The
Eventing repository owns command dispatch. `AuthzGrantProjection` and
`EventingAuthzAuditAdapter` are classes. The audit adapter supplies the
pipeline's subscriber action and keeps the existing insert-only write keyed by
the source event identity. Handling the same source event again is a successful
no-op, and replay never invokes the subscriber. This is the AuthZ instance of
Eventing's rule that every subscriber action is idempotent for its source
event. `EventingAuthzAdapter` builds the existing pipeline only when the
runtime calls it, so importing the package registers no pipeline, subscriber
or migration.

`LegacyImportAuthzGrantMigration` implements the existing `SystemMigration`
contract and keeps the current migration name, tenant status and replay
behaviour. Hashing and identity helpers used only by the import become private
methods or injected server capabilities rather than a public `/migration`
subpath.

### Public surfaces and transports

This move creates no new HTTP surface. The existing application tRPC
procedures remain separate, use the schemas and service capabilities from
`@langwatch/authz-contract`, and delegate once to the composed services. The
unified API package continues to consume AuthZ permission declarations through
the contract. Browser code continues to request effective permissions rather
than running a second server implementation.

### Dependencies

`@langwatch/authz-contract` depends only on portable packages and Zod 4.
`@langwatch/authz-server` depends on its contract plus server-safe Eventing,
observability, actor, KSUID and system-migration packages. It does not depend
on application source.

Other features, `@langwatch/api`, browser code and ordinary app services depend
only on `@langwatch/authz-contract`. Only modules below
`platform/app/src/runtime/app` and `platform/app/src/runtime/worker` may import
`@langwatch/authz-server`.

### Runtime and registration

`platform/app/src/runtime/app/features/authz.ts` is the one application
composition root. It receives the Prisma-compatible database, Redis client,
observability and validated AuthZ configuration, constructs one decision
service and one grants service, and returns the package-owned pipeline and
system migration beside those contract-typed capabilities.

The existing application preset decides whether the current process role runs
workers. Its pipeline registry installs the same AuthZ definition into the
already role-configured Eventing runtime and connects the package command
dispatcher. Web-only roles therefore expose command producers without running
projection or subscriber consumers; worker-capable roles run those consumers.
The same preset registers `LegacyImportAuthzGrantMigration` with automatic
system migrations only after the pipeline command senders are connected.
There is no second AuthZ composition root or parallel worker implementation.

`RequestApp` exposes the two capabilities to tRPC and other request code.
Ordinary services receive an `AuthzService` or `AuthzGrantsService` instead of
importing the server package, a repository or the old singleton runtime. The
old `platform/app/src/server/app-layer/authz/runtime.ts` is removed. Importing
either AuthZ package performs no registration or background work.

### Environment and configuration

Neither AuthZ package reads environment variables. Runtime configuration
validates the epoch-cache switch, cache bounds, demo-project behaviour,
pipeline wait bounds and migration registration before constructing the
feature. Redis, clocks, ID generation and failure reporting arrive through
typed class ports or constructor options.

### Errors

Denied or invalid requests preserve their current handled error codes and
public messages. Database, Redis, Eventing and migration failures remain
opaque infrastructure failures with their current telemetry. Moving files or
renaming packages must not change denial reasons, HTTP or tRPC mappings, or
failure behaviour.

Redis failure keeps the existing boundary-specific policy. Migration-state
read failure reports and routes the tenant to the legacy read head. Epoch-cache
absence or failure degrades to the authoritative uncached read. Queue Redis
failure delays projections and the audit subscriber until the worker recovers.
A revocation still applies its synchronous deny effect after the waited append,
so Redis unavailability cannot make a revoked permission remain allowed.

## Delivery sequence

1. Add the Zod 4 contract schemas and the two abstract service capabilities,
   then move the pure engine, registry, roles, declarations and errors without
   changing the registry order or exported behaviour.
2. Move the concrete services under `server/src/services`, keep the collector
   as an unexported class behind `AuthzService`, convert constructors to
   `static create`, and turn private repository and epoch seams into abstract
   classes.
3. Move the Prisma-compatible read, write, listing and migration repositories
   into the server package. Consolidate access listing behind `AuthzService`
   and keep all row mapping private.
4. Move command payloads into the contract, then move Eventing command
   handling, projections, the audit subscriber and pipeline construction into
   the server adapter. Preserve every wire constant and replay fixture. Prove
   that redelivering one source event leaves one insert-only audit row.
5. Move the system migration into the canonical migration class. Register
   automatic execution in the worker after its Eventing consumers are ready,
   while retaining app composition for operator metadata and targeted passes,
   without changing the migration name or tenant state.
6. Add the AuthZ application composition root. Provide the two contract
   capabilities through `RequestApp`, register its pipeline through the
   process-role-aware Eventing registry, and start its automatic migration only
   in worker-capable presets after command senders connect. Convert tRPC,
   middleware, API key, group, role, team, SCIM and share callers to consume
   those capabilities.
7. Rename all contract imports, remove `packages/authz`,
   `packages/authz-server`, the old server-package subpaths and displaced app
   implementations, then update workspace files, documentation and test
   filters.
8. Run contract declaration-leak checks, package typechecks and tests, AuthZ
   behavioural suites, Eventing replay tests, system-migration tests, app
   production and test typechecks, frontend boundary tests and
   `pnpm lint:architecture`.

Each step must leave one implementation of a behaviour. Temporary forwarding
modules are allowed only within an uncommitted implementation step and are
removed before the change lands.

## Alternatives considered

Moving the two directories without renaming or reorganising them would keep
the old package grammar, public repository types and app-owned implementation
split. Adding an `authz` exception to architecture lint would make the first
complex feature the precedent for bypassing the format.

Leaving Prisma and Eventing code in the app while moving only the services
would still require ordinary app modules to import server-private repository
types. Publishing those types through the contract would make persistence part
of the portable API.

Publishing separate collector, listing, cache, gate, ledger and migration
capabilities would turn implementation details into competing feature
surfaces. Two public service capabilities are enough. Private class
collaborators, repositories, ports, adapters, projections and one system
migration keep those responsibilities testable without exposing more ways to
use the feature.

Renaming every AuthZ behaviour while moving it was rejected. The current
permission model and rollout are already specified and tested. This change is
hard enough without hiding a semantic rewrite inside it.

## Consequences

- AuthZ follows the same contract/server package shape as Agents, Entitlements
  and Stored Objects.
- Cross-feature and browser consumers use one portable package name.
- Only runtime composition imports the server package.
- Prisma, Redis, Eventing, projection and migration details stop leaking into
  ordinary app code.
- The public collector and server migration subpath disappear.
- The move touches quite some imports and app constructors, but it adds no
  compatibility layer or second runtime.
- Existing authorization and rollout specs remain the behavioural source of
  truth and must pass unchanged.
