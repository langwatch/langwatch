# @langwatch/authz-server

The server-side runtime of the unified authorization engine
([ADR-092](../../dev/docs/adr/092-unified-authorization-engine.md)), in the
app-layer service/repository shape: **service classes over repository
interfaces**, with no storage engine in the package.

```
 AuthzReadRepository (interface)     what COLLECT reads - bindings, org
                                     membership, legacy rows, custom roles,
                                     share links, scope lineage
 AuthzGrantsRepository (interface)   what the write surface touches -
                                     binding writes, tenancy lookups, the
                                     atomic replace, the offboard transaction

 AuthzCollectorService   COLLECT policies + scope resolution over the reader
 AuthzService            can / check / authorize / effectivePermissions,
                         with the §12 epoch cache inside the instance
 GrantsService           attach / update / revoke / replace / offboard,
                         validation + failure naming + the offboard proof
 AuthzShadowService      the legacy resolvers' fire-and-forget comparison
```

The app implements the two interfaces with Prisma
(`platform/app/src/server/authz/repositories/*.prisma.repository.ts` -
atomicity lives in the implementations, which own the transactions) and
composes one of each service in
`platform/app/src/server/authz/runtime.ts`. The pure core - the registry,
roles, and the `AuthzEngine` these services decide with - is
[`@langwatch/authz`](../authz/README.md), whose README carries the **bible
of terms**, the **usage guide**, and the **migration digest**.
