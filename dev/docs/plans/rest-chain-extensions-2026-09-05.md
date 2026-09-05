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

## Still to build

Nothing from the survey's twelve. What a family may still need beyond them: the better-auth
router pass-through (`auth.api.ts` hands the whole `Request` to another router — reachable
today through `withRawResponse` plus `c.req.raw`, but unproven), and multipart parsing,
which no family in the survey's scope actually does.
