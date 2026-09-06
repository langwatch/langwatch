# REST chain extensions

Frozen 2026-09-05, from the gap survey (G1–G12). Companion to
`trpc-fluent-chain-2026-09-05.md`. Specs: `packages/api/specs/fluent-registration.feature`,
`packages/api/specs/endpoint-capabilities.feature`.

## The shape

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
                                                        │
                                     ┌──────────────────┴───────────────────┐
                        kind: permission                        every other kind
                        .withPermission(p)                      .withoutPermission(reason)
                        service enforcer runs                   + the check that kind names
                                                                  as route middleware
```

The three factories differ in exactly two things — the door, and which
declarations that door can stand behind. Everything else is written once.

## G1 — three scopes, one family

`createProjectVersionedApp` authenticates with the process's unified project door
(`authenticateProject(envelope)`) and resolves `requires(...)` against the caller's project
role bindings. `createServiceVersionedApp` takes the family's own `verifySecret` and, with
it, a `credentialClass` for the surfaces whose secret an API client actually holds.
`registerMountedRoute` now takes the family's scope, so the route registry records the
credential class that family's door really admits instead of assuming `organization`.

## G2 — every access declaration, not just `requires`

`policy` takes a whole `AccessPolicy` (a bare permission stays the `requires(...)`
shorthand) and installs the check that declaration NAMES:

| Declaration | What runs |
| --- | --- |
| `requires(p)` | the family's own enforcer, at the family's scope |
| `apiKeyPermission(p)` | `authorizeApiKeyCeiling` — project families only |
| `requiresOnProject(p, {param})` | `authorizeRouteProjectPermission` at the project in the path |
| `requiresOnTeam(p, {param})` | `authorizeRouteTeamPermission` at the team in the path |
| `anyAuthenticated()` | the door, and nothing else |
| `publicEndpoint(reason)` | nothing; the route declares `withAuth("none")` |
| `internalSecret(reason)` | the family's `verifySecret` |
| `handlerManagedAuth({…})` | nothing; the handler authenticates itself |

This is the one gap where a careless conversion was a security regression rather than a
cosmetic one: with only `requires`, a route scoped to the team in its path would have been
widened to the family's organization scope, and one org-wide grant would have reached every
team in it. A service family that declares a role check is refused at build time, by name.

## G3 — the error envelope is the family's, not the framework's

`errorEnvelope: "legacy" | "canonical"` picks the boundary handler the family installs as
`onError`, and the envelope its own door answers a refusal in. Default `canonical`, which
is what every family already on this framework publishes. **Ruling: a family MOVING onto
the framework passes the envelope it publishes today.** Converting must not change the 4xx
/5xx body an integrator already parses; moving a family to the canonical envelope is a
separate product decision with its own deprecation.

## G4 — the family's own error handler

`errorHandler: (boundary) => ErrorHandler` is handed the envelope's boundary to delegate
to, which is exactly what `createFamilyErrorHandler({ loggerName, label, boundary })` wants.
Passing the boundary rather than letting a family construct one is what stops a family
silently replacing the handled-error rendering it meant to layer on top of.

## G6 — `v1Alias: false`

Forwarded from the options straight to `ServiceConfig`, for the surfaces that are not the
published product API.

## G5 — a static generation instead of dated namespaces

`staticVersioning` moves from the `publicRest` block onto `ServiceConfig` itself, so a
versioned family can declare one too: `staticGeneration: "v1"` builds a one-version
selector and mounts each route ONCE, at the family's own base path. `/api/gateway/v1`,
`/api/webhooks/v1` and `/api/scim/v2` therefore answer exactly where they answer today,
with no dated namespace, no `latest` alias and no `/api/v1` twin beside them —
`canonicalV1Path` already refuses to alias a path whose segments name a generation.

## G11 — `withIdempotency({ operation, scope })`

A chain verb, and an `idempotency` port on the service beside `rateLimiter` and `cache`.
The framework reads and bounds-checks `Idempotency-Key`, dispatches through the process's
ledger, writes a replay from the STORED BYTES (never re-serialised, so a replay cannot
drift from the answer it stands in for), documents the request parameter and the
`X-Idempotent-Replay` response header, and validates a first execution against the
endpoint's declared output like any other answer. Declaring it without the port fails the
build, as does declaring it on a read — which is already safe to retry.

## G12 — SSE from any family

`registerSse` was always on the service builder; what was missing was that `policy()` was
typed to `RouteChain`, which a stream's chain is not. Widened to `DefaultsChain`, so a
stream declares its access exactly like a route and lands in the route registry the same
way. **Request-lifetime abort is deliberately NOT new mechanism**: a handler already has
`c.req.raw.signal`, which is what the long-poll family composes with `AbortSignal.any`.

## G7 — the exact request bytes

`withRawBody("bytes" | "text", { contentType })` reads the body ONCE, in the framework,
and hands it to the handler as `input.body` beside its validated path and query fields. A
handler that reached for the stream itself could not also let a signature check read it;
this is the seam that makes both possible. Declaring a raw body and a parsed input on one
route fails the build, because the body is read once.

## G8, G9, G10 — answers that are not JSON

`withRawResponse(reason, { contentType })` satisfies the "every route declares an output"
rule with a written reason instead of a schema: the handler returns a string, bytes, a
stream, or a whole `Response` — passed through untouched, so a redirect, a 304 and a
streamed body keep the headers they carry. `withHeaders({...})` sets a route's own headers
on every answer. `registerAnyMethodRoute(path, version, handler, define)` mounts one path
for every method, undocumented on purpose: a catch-all and a 405 method guard have no
operation to publish.

## A rejected request is a typed refusal, wherever it was raised

The endpoint pipeline used to throw a bare zod-shaped error. Only `createErrorHandler`
recognised it, so a family that installed an `errorHandler` of its own answered **500** for
a request every other family answered 422 for. Two workarounds grew around that —
`promoteSchemaFailures` in the package and `promoteZodError` in the api process — and both
are gone: `requestValidationErrorFrom` raises the `RequestValidationError` at the point of
rejection, so there is one refusal for a rejected request whatever raised it and whichever
boundary is installed.

## A family whose published paths are its whole contract

`bareMount: true` mounts each route ONCE, at the family's own paths: no dated namespace, no
`latest` alias, no `/api/v1` twin, and — the reason the mode exists — no version guard. Six
families sit at bare `/api`; a guard there claims `/api/:apiVersion{…}/*` and shadows every
sibling under the same prefix. The route registry names such a family for itself rather than
for the shared prefix, which would have recorded all six as `api`.

## Reading the scope, without a dependency on Hono

`projectOf(c)` / `organizationOf(c)` on `@langwatch/api/rest`, plus the
`ProjectScopedContext` / `OrganizationScopedContext` aliases and `RestErrorHandler`. They
take a structural reader rather than a whole `ServiceContext`, because Hono's context is
invariant in its variables map and a parameter naming one concrete map would refuse every
family that added a provider of its own. They throw rather than answering `undefined` when
the door did not run: a handler that read a missing project would query with a blank id,
which widens the read rather than refusing it. `@langwatch/dashboard-server` dropped its
`hono` dependency as a result.

## A header that differs per answer — no new seam

`c.header("Retry-After", …)` in the handler, then return the value as normal. The framework
serialises through the same context the handler set it on, so the header survives and the
declared output is still validated. `withHeaders(...)` remains the way to state the headers
EVERY answer carries; `withRawResponse` + a whole `Response` is for an answer that is not
JSON at all. Pinned by a test, so the cheapest of the three does not get replaced by a seam
later.

## HEAD, a pre-flight and a decline — the three late additions

`head` joins `HttpMethod`, so a family registers GET and HEAD on one path and the registry
and the document carry both. Hono answers HEAD from the GET route BEFORE routing, so the
HEAD registration cannot run: it exists for the registry and the published document, and
the framework says so where it registers it.

`withIdempotency({ …, preflight })` names the read-only authorization a create needs beyond
its endpoint permission. It runs OUTSIDE the ledger, on a replay too, because a receipt must
not answer for a grant the caller has since lost — the hand-wired creates it replaces made
exactly that distinction by leaving the pre-flight above the ledger call.

`declined()` is what an any-method route returns when the request is not its own: the
pipeline calls `next()` instead of writing a response, so namespaces mounted after it keep
their own routing and their own 404. It is the one thing the OTLP path-alias family needed
that a chain handler could not express, since a chain handler has no `next`.

## Still to build

Nothing from the survey's twelve. What a family may still need beyond them: the better-auth
router pass-through (`auth.api.ts` hands the whole `Request` to another router — reachable
today through `withRawResponse` plus `c.req.raw`, but unproven), and multipart parsing,
which no family in the survey's scope actually does.
