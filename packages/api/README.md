# @langwatch/api

LangWatch's API framework. `package.json` exports eleven entry points: five
that features and a module's browser import, five that a process composes
from, and `./dates`, one schema helper. What a feature declares, `defineTrpcContract`, lives in the light core,
`@langwatch/module`, so a contract depends on no framework (ARCHITECTURE.md §2).

| Import                  | What it is                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@langwatch/api/access` | `decide`: the one access check both transports run after the parser — the three declarations, the scope-lineage guard, the blank-scope-id refusal and the project-id mismatch refusal. Names no transport.                                                                                                                                                    |
| `@langwatch/api`        | The transport-agnostic vocabulary: the handled-error classes and their wire envelope, the access-policy vocabulary (`requires`, `publicEndpoint`, `credentialClassFor`, …), the rate-limit and cache ports, and the Standard Schema boundary. Imports no transport framework.                                                                                 |
| `@langwatch/api/rest`   | `defineRestRouter` and the REST runtime on Hono: addressing (`/api/<x>`, `/api/v1/<x>`), input and output validation, credentials and doors, route-chain capabilities, OpenAPI generated from the routes, SSE responses.                                                                                                                                      |
| `@langwatch/api/trpc`   | The typed tRPC root and the policy spine every procedure runs through: tracing, request logging, handled-error translation, scope lineage, declared authorization and audit, all over injected ports.                                                                                                                                                         |
| `@langwatch/api/web`    | The browser's half: `createModuleApi` derives a feature's typed tRPC hooks from its own contract, and `trpcQueryKey` / `trpcQueryFilter` / `useInvalidateProcedure` reach a procedure no contract the package names declares yet. React and `@trpc/react-query` live here and nowhere else in the package. It is the ONLY entry a browser package may import. |

The five a process composes from, and `./dates`:

| Import                             | What it is                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@langwatch/api/hosting`           | One muxer for the process: the API door (`bindApiDoor`), `/api` and the browser app behind `/`      |
| `@langwatch/api/hosting/selection` | `TransportSelection`: which surfaces (REST, the browser bundle) a process serves, and their headers |
| `@langwatch/api/hosting/mux`       | The HTTP muxer's listener and its types (`HttpHandler`, `HttpMiddleware`, `HttpTarget`)             |
| `@langwatch/api/policy`            | The base response policies a process composes from (browser origin, client address, …)              |
| `@langwatch/api/composition`       | `createTrpcHandlerBinding`: how a process binds a declared procedure                                |
| `@langwatch/api/dates`             | `flexibleDateSchema`, an epoch-or-ISO date schema (analytics' and trace's contracts import it)      |

None re-exports another. A consumer that wants the error vocabulary imports
`@langwatch/api`; one that wants the REST builder imports `@langwatch/api/rest`;
one wiring tRPC imports `@langwatch/api/trpc`; one _declaring_ procedures for
both a process and a browser imports `@langwatch/module`; a module's browser
package imports `@langwatch/api/web`. Most REST call sites need two of the
first five, and that is the point — the import says which half of the framework
a file depends on.

REST is built on top of [Hono](https://hono.dev) and [hono-openapi](https://github.com/rhinobase/hono-openapi). Existing services accept Standard Schema; the public REST surface requires Zod 4 so it can derive HTTP documentation from one input object. tRPC is built on [@trpc/server](https://trpc.io) and chooses none of its concretes.

The lasting decisions live in [adrs/](./adrs), including [the fluent handler contract](./adrs/001-rpc-first-fluent-registration.md), [public REST versioning](./adrs/004-public-rest-v1-and-date-negotiation.md) and [the tRPC framework boundary](./adrs/20260828-trpc-framework-boundary.md). Behaviour lives in [specs/](./specs); this README is usage.

## Declaring a feature's transports

A tRPC procedure is declared **once**, in the feature's contract, and bound
**once**, in the module's process half. Design:
[the transport declaration split](./adrs/20260908-transport-declaration-split.md).
Behaviour: [specs/transport-declaration-split.feature](./specs/transport-declaration-split.feature).

```ts
// contract/src/annotation.trpc.ts — imports zod and its own schemas, nothing else.
import { defineTrpcContract } from "@langwatch/module";

export const annotationTrpc = defineTrpcContract("annotation")
  .query("getById")
  .withInput(annotationScopeSchema)
  .withOutput(annotationSchema)
  .mutation("deleteById")
  .withInput(annotationScopeSchema)
  .build();
```

```ts
// server/src/transport/annotation.trpc.ts — the permission and the handler, and nothing else.
import { defineTrpcRouter } from "@langwatch/api/trpc";

export const annotationTrpcTransport = defineTrpcRouter(AnnotationApi, annotationTrpc)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) => app.getById({ id: input.annotationId }))
  .procedure("deleteById")
  .withPermission("annotations:delete")
  .handle(async ({ app, input }) => app.deleteReview(input))
  .build();
```

`.procedure(name)` selects a member the contract declared and inherits its kind,
its parser and its answer. The compiler refuses an undeclared name, a second
implementation of one name, a `build()` that left one unimplemented, a `handle`
before `withPermission` / `noPermission` / `serviceAuthorized`, and a handler
whose answer the declared output refuses. The declaration carries no process
generic and no runtime import: `router(runtime, app)` is where the host's root,
ports and application slice arrive.

The browser derives its client from the same declaration, so no map restates it:

```ts
// web/src/behavior/annotation-api.ts
export const annotationApi = createModuleApi<ContractApiMap<typeof annotationTrpc>>();
```

REST is declared whole in the server, because it has no browser half to share a
declaration with:

```ts
export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)
  .get("/:id", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => ({
    data: await app.getById({ id: input.id, projectId: scope.id }),
  }))
  .build();
```

`withNamespace` is the family's own path segment, so the routes answer under
`/api/<namespace>` and the process mount reads the name off the declaration
rather than restating it. A route declared without `withOutput` is served as 204
with an empty body.

### Mounting a declaration

A declaration is inert. The process builds one runtime per transport, from the
collaborators it already holds, and mounts each declaration on it.

```ts
// The tRPC path, built once per root beside the process's own policy chain.
const runtime = createTrpcRuntime({ root, procedure: authenticatedProcedure, ports });
const annotation = runtime.mount(annotationTrpcTransport, (ctx) => ctx.app.annotation);
```

```ts
// The REST path. `identity.authenticate` is the family's own door; the runtime
// answers a Hono app the process mounts.
const rest = createRestRuntime({ identity: { authenticate } });
const annotations = rest.mount(annotationRest.router(), {
  app: () => annotationApi,
  onError: annotationErrorHandler,
});
```

The declaration names its own door, and the handler's `scope` follows it. Six
doors exist, each declared with `.withCredential(...)` before the family's first
route: `projectKey`, which every declaration gets without asking, and `session`,
the browser cookie the application's own pages carry, both resolving
`{ tier: "project", id }`; `organizationKey` and `scimToken`, which resolve
`{ tier: "organization", id }`; and `internalSecret` and `instanceAdminKey`,
which name no tenant at all and hand their handlers `scope: null`. A mount that
names a different door is refused. `public` is named on the mount alone, because
no door resolves a declared scope for it, and a family behind `session`
publishes no operation, since no API client can present a cookie.

A route may declare how it is reached instead of naming a permission:
`publicRoute` resolves no credential, `anyAuthenticated` opens the door and asks
nothing of it, `optionalCredential` answers with or without one (the handler
reads a nullable actor and scope), and `deferredScope` authenticates the caller
and leaves the owning scope for the handler, for a resource addressed by an id
that names its own owner. Each takes the written reason the registry records.

```ts
const roleRest = defineRestRouter(RoleApi)
  .withNamespace("roles")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organizationKey")
  .get("/", "listRoles")
  .withPermission("organization:manage")
  .withOutput(roleRestListSchema)
  .handle(async ({ app, scope }) => ({ roles: await app.listRoles({ organizationId: scope.id }) }));
```

`ApiRuntimePorts` are the process's, not the feature's: `identity` says who is
calling, `authorization` answers the permission decisions, `denials` supplies
the two refusals whose copy is the product's, `audit` records and redacts, and
`errors` reports and translates. A feature declaration names none of them.

### The one execution path

Both runtimes run the same boxes, and each is the same body it was:

```
tRPC   authenticate ─▶ parse ─▶ trace ─▶ log ─▶ decide ─▶ handle ─▶ check output ─▶ audit ─▶ respond
REST   parse ─▶ authenticate ─▶ decide ─▶ handle ─▶ check output ─▶ respond
```

The two orders differ, deliberately, and each is the order its families already
answer in. On tRPC, everything that reads the request reads the **validated**
input, so trace, log, the handled-error boundary, the check and the audit row
are installed **after** the contract's own `.input()` parser — a check ahead of
it is handed `undefined` and authorizes nothing. On REST the request is parsed
**before** the credential is resolved, so a malformed body is refused without
ever touching the caller's key.

What a handler is handed never changes: `{ app, input, actor, scope, signal }`,
plus `target` on REST, which is the scope a route's own path named when its
permission was checked there. No `ctx`, no request, no response, no framework
type. The access step writes those facts onto the request context through
tRPC's own `next({ ctx })`, and a procedure that somehow reached its handler
without them refuses by name.

A declared REST route answers at three addresses — its dated namespace,
`latest`, and the family's bare path — plus the `/api/v1` twin of each, and any
real date the caller pins is served by the latest registration on or before it.
`.withAddressing(...)` before the first route says otherwise: `"v1-only"` serves
`/api/v1/<namespace>/...` alone, `"v1-in-path"` serves
`/api/<namespace>/<generation>/...` alone — `("v1-in-path", { generation: "v2" })`
for a protocol whose generation is not ours to choose, such as SCIM 2.0 —
`("dated", { v1Twin: false })` keeps the three dated addresses with no twin
beside them, and `"literal"` publishes exactly the paths its routes write, each
with its `/api/v1` twin, for a family sharing `/api` with everything else rather
than owning a namespace of its own. A literal family's routes name their whole
address, and it claims no wildcard under the prefix it shares.

A route names either a permission or an access kind. `.withPermission(p)` asks
`p` at the scope the credential resolved; `.withPermission(p, { at: "route",
param: "projectId" })` asks it at the scope the route's own path names, through
`identity.authorize`. A path that spells the scope under another name says so: `{ at: "route",
param: "projectId", field: "id" }` reads the project from `:id`. `.withAccess(publicRoute({ reason }))` resolves no
credential at all; `.withAccess(anyAuthenticated({ reason }))` opens the
family's door through `identity.identify` and asks no permission of it. A route
may also declare several answers — `.responds({ 200: report, 503: report })` —
and then returns `{ status, body }` typed by that map.

### Removed, and what replaces it

`createService`, `createRestService`, `ServiceBuilder`, `registerRoute`, the
`onRouteMounted` mounting callback and raw-`{ ctx, input }` tRPC handlers are
removed. A REST route is a `defineRestRouter` declaration and a tRPC procedure a
`defineTrpcRouter` binding (`dev/docs/ARCHITECTURE.md` §8); the process mounts
every installed module's declarations (§4).

## Addressing and versions

`/api/<x>` is the main path and `/api/v1/<x>` also answers; `/latest/` and
`/<YYYY-MM-DD>/` are served but hidden from the published document (§8). A dated
URL is served by the newest registration on or before that date, `latest` by
the newest registrations, and `preview` never joins `latest`. An unknown version
namespace is refused. Errors carry the version headers (`X-API-Version`,
`X-API-Version-Status`) too. `.withAddressing(...)` changes the family's
addresses, as described above. Specified in `specs/versioned-routing.feature`.

## Endpoint capabilities

A route declares what it needs on its own chain: `.withRateLimit(...)`,
`.withCache(...)`, `.withDeprecated(...)`, `.withIdempotency(...)`,
`.withEntitlement(...)`. Rate limiting and response caching need a substrate the
framework does not own, so the package declares the ports (`ports.ts`) and the
process supplies them to the REST host. A capability declared without its port
fails the build, naming the route; an endpoint without an output is never
cached; a cache failure degrades to a handler call. Specified in
`specs/endpoint-capabilities.feature`.

## OpenAPI documentation

Everything in `.withDocs(...)` reaches the published operation. One logical
route reaches the document once: the dated and `latest` aliases are served but
not documented, and `preview` never is. A route's REST response schema comes
from its own declaration; a hand-written `*-openapi.rules.ts` file is a deleted
spelling (§15), and a response that truly needs its own schema goes through
`documentedResponses()`.

## SSE streaming

A stream is a route in a `defineRestRouter` declaration with `.withResponse("sse", {})`. Its handler answers `response.events(source)`, where `source` is an `AsyncIterable<RestEvent>` (`{ event?, data, id?, retryMs? }`, `data` already a string). The framework frames the events, publishes `text/event-stream` and ends the handler's own stream when the caller hangs up. A route that answers JSON or a stream by the caller's `Accept` declares `.withResponse("negotiated", {})` and branches on `response.wantsEvents`. Specified in `specs/declared-response-kinds.feature`.

## Error handling

There is one error format. The version-gated union envelope carrying the legacy `error` field died with the bare alias (ADR 002).

Throw `HandledError` subclasses (from `@langwatch/handled-error`). The framework:

1. Catches and serializes them with `code`, `meta`, `reasons`, `traceId`/`spanId`,
   plus the remediation channel (`fault`, `tips`, `docsUrl`)
2. Catches `ZodError` and promotes it to a `ValidationError`, mapping each issue
   to a `schema_failure` reason
3. Publishes the error it sent, and the status it sent it as, for the request
   logger to consume

The request logger writes **exactly one** error record per failed request.
Level comes from `fault` when the error is handled (`customer` → warn,
`platform` / `provider` → error) and from the status code otherwise (5xx →
error, 4xx → warn) — so an unknown error, which is flattened to a 500, logs at
`error` with its cause, while an unhandled `HTTPException` carrying a 4xx logs
at `warn`. The error handler deliberately logs
nothing itself: a second record there would double every error-log-derived
alert and count. It publishes the _promoted_ error, so a `ZodError` is reported
as the 422 `ValidationError` the caller actually received rather than the 500 a
re-derivation would guess.

Only real `HandledError` instances are trusted. An object that merely grows a
`code` + `httpStatus` + `serialize()` is treated as unknown and answered with a
500 — it cannot talk its way into choosing its own status.

Request bodies are never logged.

Validation error example:

```json
{
  "code": "validation_error",
  "message": "Validation error",
  "reasons": [
    {
      "code": "schema_failure",
      "meta": {
        "field": "url",
        "type": "invalid_string",
        "message": "must be a valid URL"
      }
    },
    {
      "code": "schema_failure",
      "meta": {
        "field": "title",
        "type": "too_small",
        "message": "title is required"
      }
    }
  ]
}
```

## Testing

Test a declaration through the real router, asserting status, body and the
error `code`; never a handler called by hand. Exemplars:
`modules/agent/process/src/transport/__tests__/agent-rest-family.integration.test.ts`
for a module's family, and
`packages/api/src/rest/__tests__/transport-conventions.integration.test.ts` for the
framework itself. The `api-transports` skill teaches the rest.

Unit tests: `pnpm --filter @langwatch/api test`

## File structure

One folder or file per entry point in `package.json`'s `exports`:

```
src/
  index.ts           # "."            the transport-agnostic vocabulary: handled errors, access policies, ports, schema boundary
  access/            # "./access"     decide(): the one access check both transports run
  rest/              # "./rest"       defineRestRouter, the REST runtime, addressing, credentials and doors, OpenAPI
  trpc/              # "./trpc"       defineTrpcRouter's root, the one execution path, audit, SSE
  web/               # "./web"        createModuleApi and the browser's tRPC cache-key helpers
  hosting/           # "./hosting", "./hosting/selection", "./hosting/mux": one muxer, /api and the browser app
  policy/            # "./policy"     the base response policies a process composes from
  composition.ts     # "./composition" createTrpcHandlerBinding: how a process binds a declared procedure
  dates.ts           # "./dates"      an epoch-or-ISO date schema
```

## LLM instructions

The rules are `dev/docs/ARCHITECTURE.md` §8 and the `api-transports` skill; this list only points.

1. A module's transports are declarations in `modules/<name>/process/src/transport/<name>.{rest,trpc}.ts`:
   `defineRestRouter(<Name>Api)` and `defineTrpcRouter(<Name>Api, <name>Trpc)`, the tRPC names declared once
   in the contract with `defineTrpcContract`.
2. The installer lists them on `.withTransports(...)`; the process mounts every installed module's
   declarations (§4). Never mount by hand, never write a per-module composition file under `apps/`.
3. Every route declares `.withInput` (or `.withParams`/`.withQuery`), `.withOutput` or `.responds`,
   `.withPermission(...)` and `.withDocs(...)`. Paths are `/api/<x>`; `/api/v1/<x>` also answers.
4. A handler receives `{ input, app, actor, scope, signal }`, calls one `*Api` operation and returns a
   plain value or throws a `HandledError`. No `c.json`, status branches or error envelopes.
5. Middleware never does the framework's work (authentication, JSON body parsing), and a route opened to
   any caller is drift (§8, 2026-10-05). A case the declaration cannot express is a gap here: extend this
   package and the door.
6. Test the declaration through the real router, asserting status, body and `code`.
