# @langwatch/authz-server

The server-side runtime of the unified authorization engine
([ADR-092](../../dev/docs/adr/092-unified-authorization-engine.md)), in the
app-layer service/repository shape: **service classes over repository
interfaces**, with no storage engine in the package.

```text
 AuthzReadRepository (interface)     what COLLECT reads - bindings, org
                                     membership, legacy rows, custom roles,
                                     share links, api-key ownership,
                                     scope lineage
 AuthzGrantsRepository (interface)   what the write surface touches -
                                     binding writes, tenancy lookups, the
                                     atomic replace, the offboard transaction

 AuthzCollectorService   COLLECT policies + scope resolution over the reader
 AuthzService            can / check / authorize / effectivePermissions,
                         with the §9 owner ceiling and the §12 epoch cache
                         inside the instance
 GrantsService           attach / update / revoke / replace / offboard,
                         validation + failure naming + the offboard proof
 AuthzShadowService      the legacy resolvers' fire-and-forget comparison
```

Nothing here reads the environment. Sample rates, the demo project id and
the cache flag all arrive as closures through a service's constructor
options, so the app's composition root is the single place `process.env` is
touched.

The app implements the two interfaces with Prisma
(`platform/app/src/server/app-layer/authz/repositories/*.prisma.repository.ts` -
atomicity lives in the implementations, which own the transactions) and
composes one of each service in
`platform/app/src/server/app-layer/authz/runtime.ts`. The pure core - the registry,
roles, and the `AuthzEngine` these services decide with - is
[`@langwatch/authz`](../authz/README.md), whose README carries the **bible
of terms**, the **usage guide**, and the **migration digest**.
