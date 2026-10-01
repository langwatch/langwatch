# 005: The REST chain covers every family, not only the simple ones

**Date:** 2026-09-05

**Status:** Accepted

## Context

A gap survey found twelve things a real family needed that the fluent REST
registration could not express. Each one was a reason for a family to stay
hand-wired, and a hand-wired family bypasses the policy chain, the route
registry and the published document. Specs:
`packages/api/specs/fluent-registration.feature`,
`packages/api/specs/endpoint-capabilities.feature`.

## Decision

One family builder, three doors, and everything else written once.

```
  createAppRestSecurity(ports)
     │
     ├── createVersionedApp        ─┐
     ├── createProjectVersionedApp  ├─►  versionedFamily({ ports, options, scope, verifySecret })
     └── createServiceVersionedApp ─┘          │
                                               ├── door        project | organization | secret
                                               ├── envelope    legacy | canonical  →  onError
                                               ├── errorHandler(boundary)          →  onError
                                               └── policy(AccessPolicy)
```

The three factories differ in exactly two things: the door, and which access
declarations that door can stand behind.

**Three scopes, one family.** `createProjectVersionedApp` authenticates with the
process's project door and resolves `requires(...)` against the caller's project
role bindings. `createServiceVersionedApp` takes the family's own
`verifySecret` and a `credentialClass`. `registerMountedRoute` takes the
family's scope, so the route registry records the credential class the door
really admits.

**Every access declaration installs the check it names**, not only `requires`.
`apiKeyPermission`, `requiresOnProject`, `requiresOnTeam`, `anyAuthenticated`,
`publicEndpoint`, `internalSecret` and `handlerManagedAuth` each map to one
runtime behaviour, and a service family that declares a role check is refused at
build time. This is the one gap where a careless conversion was a security
regression: with only `requires`, a route scoped to the team in its path would
have been widened to the family's organization scope, and one organization-wide
grant would have reached every team in it.

**The error envelope is the family's.** `errorEnvelope: "legacy" | "canonical"`
picks the boundary handler the family installs as `onError`. Default is
`canonical`. **A family moving onto the framework passes the envelope it
publishes today.** Converting must not change the body an integrator already
parses. `errorHandler: (boundary) => ErrorHandler` is handed the envelope's
boundary to delegate to, which stops a family from silently replacing the
handled-error rendering it meant to layer on top of.

**A rejected request is a typed refusal wherever it was raised.**
`requestValidationErrorFrom` raises `RequestValidationError` at the point of
rejection, so a family with its own error handler answers 422 like every other
family. The two workarounds that grew around the old bare zod-shaped error are
deleted.

**Mounting modes.** `v1Alias: false` for a surface that is not the published
product API. `staticGeneration: "v1"` for a family that publishes one generation
at its own base path, with no dated namespace and no `/api/v1` twin.
`bareMount: true` for a family whose published paths are its whole contract:
each route mounts once, with no version guard, because a guard at a bare `/api`
prefix claims `/api/:apiVersion{…}/*` and shadows every sibling.

**Bodies and answers.** `withRawBody("bytes" | "text", { contentType })` reads
the body once, in the framework, and hands it to the handler beside its
validated path and query fields, so a signature check and the handler can both
read it. `withRawResponse(reason, { contentType })` satisfies the
every-route-declares-an-output rule with a written reason, and passes a string,
bytes, a stream or a whole `Response` through untouched.
`withHeaders({...})` sets the headers every answer carries; a per-answer header
is `c.header(...)` in the handler, with no new seam.
`registerAnyMethodRoute` mounts one path for every method and is undocumented on
purpose. `declined()` is what such a route returns when the request is not its
own: the pipeline calls `next()`, so namespaces mounted after it keep their own
routing and their own 404.

**Idempotency and streams.** `withIdempotency({ operation, scope, preflight })`
is a chain verb with an `idempotency` port beside `rateLimiter` and `cache`. The
framework bounds-checks the key, dispatches through the process's ledger, and
writes a replay from the stored bytes, never re-serialised, so a replay cannot
drift from the answer it stands in for. Declaring it without the port fails the
build, as does declaring it on a read. `preflight` names the read-only
authorization a create needs beyond its endpoint permission, and it runs outside
the ledger, on a replay too, because a receipt must not answer for a grant the
caller has since lost. `registerSse` takes `policy()` the same way a route does,
because the chain type was widened to `DefaultsChain`. Request-lifetime abort is
deliberately not new mechanism: a handler already has `c.req.raw.signal`.

**Reading the scope without depending on Hono.** `projectOf(c)` and
`organizationOf(c)` take a structural reader rather than a whole
`ServiceContext`, because Hono's context is invariant in its variables map and a
parameter naming one concrete map would refuse every family that added a
provider of its own. They throw rather than answering `undefined` when the door
did not run: a handler that read a missing project would query with a blank id,
which widens the read rather than refusing it.

## Consequences

Every family can move onto the framework, so the route registry and the
published document describe the whole surface. Two things a family may still
need are unproven: the better-auth router pass-through, which hands a whole
`Request` to another router, and multipart parsing, which no family in the
survey's scope does.

## References

- [Endpoint capabilities are ports](./003-endpoint-capabilities-are-ports.md)
- [Public REST v1 and date negotiation](./004-public-rest-v1-and-date-negotiation.md)
- [The tRPC fluent chain](./006-trpc-fluent-chain.md)
- `dev/docs/plans/strict-feature-layout.md` section 4 item 29
