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

## Still to build, in the order the survey ranked them

- **G5 static generations.** `/api/gateway/v1`, `/api/webhooks/v1`, `/api/scim/v2` are static
  generations, not dated ones. `createRestService` already has `staticVersioning`, but it
  lives on the `publicRest` config and the versioned family mounts dated namespaces. The
  extension is to let a versioned family declare its generation instead of a date, and
  mount one namespace rather than dated + `latest` + the `/api/v1` twin.
- **G11 `withIdempotency()`.** `packages/api/src/rest/idempotency.ts` exists; the verb does
  not. It should declare the key parameter in the document, replay through the ledger, and
  set the replay headers, so `webhook.api.ts` stops wiring three helpers by hand.
- **G12 SSE from any family.** `registerSse` is on the service builder already; it needs to
  be reachable from the project- and service-scoped factories.
- **G7 raw bodies.** `withRawBody("bytes" | "text")` hands the handler the exact bytes
  BEFORE parsing — what a webhook signature is computed over, and what an OTLP protobuf
  body is. Nothing else can be layered on top of a parsed body after the fact.
- **G8 non-JSON answers.** `withResponse({ contentType, status })` for
  `application/scim+json` and `text/plain`, `withRedirect()`, a no-body status (202/204/304),
  and a stream response for the byte-serving families.
- **G9 headers and cookies**, **G10 `.all()`**, **G12** request-lifetime abort for the
  long-poll family.

Each of those lands with a scenario in `endpoint-capabilities.feature` before its code.
A family needing one of them is NOT converted with raw Hono in the meantime: it waits.
