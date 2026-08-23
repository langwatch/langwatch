# @langwatch/authz-server

The server implementation of the portable
[`@langwatch/authz-contract`](../contract/README.md). It owns the concrete
decision and grant services, private repository ports, Prisma-compatible
adapters, Eventing pipeline and projection, Redis epoch adapter, audit
subscriber, and the legacy-import system migration.

The public composition entry point is:

```ts
const feature = PostgresAuthzAdapter.create(options).build();
// feature.authz      AuthzService
// feature.grants     AuthzGrantsService
// feature.pipeline   package-owned Eventing definition
// feature.migration  package-owned SystemMigration
```

`AuthzService` and `AuthzGrantsService` are the only domain capabilities.
Collectors, repositories, routing gates, caches, ledgers and projections are
implementation collaborators, not additional services for application code to
construct.

The package reads no environment variables and imports no application source.
Its database, Redis handle, telemetry, clocks, ID generation and cache policy
arrive through `PostgresAuthzAdapter` options. Importing the package registers
no pipeline, subscriber or migration.

Only an application runtime composition root imports this package. Ordinary
server, transport and browser code depends on `@langwatch/authz-contract` and
receives the two service capabilities through its runtime context.

The package preserves the existing `authz_grant` Eventing wire constants,
grant/role aggregate identities, projection rows and `authz-engine` system
migration identity. Audit subscriber writes are insert-only and idempotent by
source-event identity; the tenant comes from the Eventing envelope rather than
the grant or role aggregate ID.
