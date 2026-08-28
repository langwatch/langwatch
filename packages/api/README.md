# @langwatch/api

LangWatch's API framework, in three entry points.

| Import                | What it is                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@langwatch/api`      | The transport-agnostic vocabulary: the handled-error classes and their wire envelope, the access-policy vocabulary (`requires`, `publicEndpoint`, `credentialClassFor`, …), the rate-limit and cache ports, and the Standard Schema boundary. Imports no transport framework. |
| `@langwatch/api/rest` | The contract-sealed Hono service framework: explicit version namespaces, input/output validation, OpenAPI documentation, capability middleware, SSE streaming, the route-policy registry and the REST service builder.                                                        |
| `@langwatch/api/trpc` | The typed tRPC root and the policy spine every procedure runs through: tracing, request logging, handled-error translation, scope lineage, declared authorization and audit, all over injected ports.                                                                         |

The three do not re-export one another. A consumer that wants the error
vocabulary imports `@langwatch/api`; one that wants the REST builder imports
`@langwatch/api/rest`; one wiring tRPC imports `@langwatch/api/trpc`. Most REST
call sites need two of the three, and that is the point — the import says which
half of the framework a file depends on.

REST is built on top of [Hono](https://hono.dev) and [hono-openapi](https://github.com/rhinobase/hono-openapi). Existing services accept Standard Schema; the public REST surface requires Zod 4 so it can derive HTTP documentation from one input object. tRPC is built on [@trpc/server](https://trpc.io) and chooses none of its concretes.

The lasting decisions live in [adrs/](./adrs), including [the fluent handler contract](./adrs/001-rpc-first-fluent-registration.md), [public REST versioning](./adrs/004-public-rest-v1-and-date-negotiation.md) and [the tRPC framework boundary](./adrs/20260828-trpc-framework-boundary.md). Behaviour lives in [specs/](./specs); this README is usage.

## Public REST (opt-in)

`createRestService` is the future public HTTP surface. Nothing uses it until a
family opts in during the API app migration.

```ts
import { createRestService } from "@langwatch/api/rest";
import { z } from "zod";

const app = createRestService({ name: "thing" })
  .get(
    "/:id",
    "2026-08-27",
    async (context, input: { id: string; verbose: boolean }) => context.app.thing.get(input),
    (builder) =>
      builder
        .withInput(
          z.object({
            id: z.string(),
            verbose: z.coerce.boolean(),
          }),
        )
        .withOutput(thingSchema),
  )
  .build();
```

There is one request schema. Path parameters are merged automatically; GET
reads the other fields from query, and POST/PUT/PATCH/DELETE read them from a
JSON body. The complete input and output are validated at runtime.

```text
/api/v1/thing/:id                         # latest by default
/api/v1/thing/:id + X-API-Version: date  # header-pinned
/api/v1/thing/date/:id                    # URL-pinned
/api/v1/thing/latest/:id                  # explicit latest
```

If URL and header versions are both present, they must match. The OpenAPI
document includes the optional path, registered dates and `latest`.

## Versioned HTTP services

A service is one file exporting a built Hono app. An endpoint is one `registerRoute` call carrying its method, its path, its version, its handler and its definition chain:

```ts
// src/app/api/things/[[...route]]/app.ts
import { z } from "zod";
import { createProjectApiService } from "~/server/api/project-service";

const thingSchema = z.object({ id: z.string(), name: z.string() });

export const app = createProjectApiService({
  name: "things",
  basePath: "/api/things",
})
  .registerRoute(
    "post",
    "/things.create",
    "2026-08-07",
    async (context, input: { projectId: string; name: string }) =>
      context.app.things.create({
        ...input,
        actorId: context.actor().id,
      }),
    (b) =>
      b
        .withInput(
          z.object({
            projectId: z.string().min(1),
            name: z.string().min(1),
          }),
        )
        .withOutput(thingSchema)
        .withStatus(201)
        .withDocs({ operationId: "createThing", tags: ["Things"] }),
  )
  .registerRoute(
    "post",
    "/things.list",
    "2026-08-07",
    async (context, input: { projectId: string }) => context.app.things.list(input),
    (b) =>
      b
        .withInput(z.object({ projectId: z.string().min(1) }))
        .withOutput(z.array(thingSchema))
        .withDocs({ operationId: "listThings", tags: ["Things"] }),
  )
  .build();
```

The built app carries its own base path (`/api/things` from `name`, or an explicit `basePath`), so the host's API router mounts it at the root, next to every other service:

```ts
// src/server/api-router.ts
import { app as thingsApp } from "../app/api/things/[[...route]]/app";

api.route("/", thingsApp);
```

### Legacy Next-style hosts

`routeHandlers(app)` converts a built app into `{ GET, POST, PUT, PATCH, DELETE }` handlers via `hono/vercel` for hosts that export per-file route handlers instead of mounting a Hono router. It stays exported for those hosts; services in this repo export the Hono app and are mounted by the api-router as above.

## Compatibility registration methods

- **`registerRoute(method, path, version, handler, define)`** — the existing HTTP endpoint API. It retains explicit path, query and body schemas until migrated to `createRestService`. Every route declares `withOutput`; use `z.void()` for an endpoint with no response body.
- **`registerSse(name, version, handler, define?)`** — a dotted name mounted as a GET, with `.withEvents({...})` / `.withQuery(...)`. The name is an identifier, not a URL: slash-less, dotted lower-camelCase, at least one dot — `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`, checked by `assertSseName` at registration. See SSE streaming below.
- **`withdraw(name, version)`** — answers 410 Gone from that version onward, on every mount, with the withdrawn endpoint's config still on the mount report.

An earlier revision offered a third style: `register(name, version, ...)` mounted a dotted RPC operation as a POST, with a compile-time name grammar and a raw-`Response` escape hatch. No service ever registered one, so it and the `rpc.discover` catalogues derived from it were removed.

## The handler contract

Handlers are positional: `(context, input)` — the Hono context and the
validated input. There is no destructured bag. The process-composed application
and authenticated principal are direct context capabilities:

```ts
.registerRoute("patch", "/:id", "2026-08-07", async (context, input: UpdateThing) => {
  const things = context.app.things;       // one process-composed service
  const actorId = context.actor().id;      // authenticated request principal
  await context.authorize("traces:view"); // when validated input selects a permission
  return things.update({ ...input, actorId });
}, (b) => b.withParams(idParams).withInput(updateThingSchema).withOutput(thingSchema));
```

Compatibility `registerRoute` uses `withParams`, `withQuery` and `withInput`.
Public REST uses one `withInput`; its method selects query or JSON.

A feature handler never creates a repository, constructs a service or awaits a
service resolver. Project-scoped operations include `projectId` in their validated
input. The application authentication middleware must authorize that exact
project before the handler runs, which lets multi-project credentials choose a
target without trusting an arbitrary tenant id.

Static permissions stay on `.withPermission(...)`. Use
`context.authorize(permission)` only when validated input selects an additional
permission, such as a stored object's delivery audience.

One honesty note on types: `input` is declared on the definition chain, which
is the argument _after_ the handler — TypeScript checks arguments in order, so
the chain cannot flow back into the handler's parameter type. Annotate `input`
(or delegate to a typed domain function) as above; the declared schema is
always the runtime guarantee. The registration type requires a declared input
source whenever the handler declares the input parameter. Every route requires
`withOutput`. A handler with no request
values takes only `context`.

Return raw data: the framework validates and serializes it. A REST handler
cannot return a hand-built `Response`; use `z.void()` for an endpoint with no
body. Success is `withStatus(201)` or 200 by default, and 204 for a no-body
schema. A schema accepting both `undefined` and a value is refused.

## The definition chain

The chain is the only extension point — a new capability is a new chain call and never changes the registration signature:

```ts
(b) => b
  .withInput(z.object({ ... }))        // JSON body source (not on SSE)
  .withOutput(thingSchema)             // response schema: validates + OpenAPI (not on SSE)
  .withParams(z.object({ id: z.string() }))   // REST path fields merged into input
  .withQuery(z.object({ limit: z.coerce.number() }))  // REST query fields merged into input
  .withStatus(201)                     // success status (default 200; 204 with no body)
  .withDocs({ summary, description, operationId, tags, security, responses, hide })
  .withAuth("none")                    // or a MiddlewareHandler; default is the service auth
  .withResourceLimit("things")         // requires _legacy.resourceLimitMiddleware
  .withMiddleware(auditor())           // stacks: service, group, endpoint
  .withMeta({ policy: ... })           // opaque; travels on the mount report, never the document
  .withRateLimit()                     // requires the rateLimiter port
  .withCache("things", 60)             // tag + ttlSeconds; requires the cache port and withOutput
  .withDeprecated("use things.createV2 after 2026-11-01")
  .withoutCache()                      // opt out of a service/group default
  .withoutRateLimit()
```

`withDocs` is the documentation channel: everything in it reaches the published operation. `withMeta` is the opaque channel the framework never reads: it travels on `MountedRoute.config` so hosts can attach route policies. They are not interchangeable.

### Service-level defaults and groups

A `.withX()` on the service builder is the default for every endpoint; endpoint re-declaration wins; middleware stacks. `service.group(name, define?)` returns a registrar (`registerSse`/`registerRoute`/`withdraw`) whose chain declares defaults for everything registered through it. `registerRoute` paths are used as-is; `registerSse` and `withdraw` prefix the group name onto a dotted name (`things.registerSse("watch", ...)` → `things.watch`). Precedence runs service < group < endpoint. Groups do not nest and carry no version.

## Version namespaces

Every `createService` URL names its version namespace; there is no bare alias:

```text
/api/{service}/{YYYY-MM-DD|latest|preview}/{name}
```

The version catalogue is the union of versions named in registration calls. An endpoint serves at version V its latest registration dated on or before V — including a real date nobody registered (`/api/things/2026-03-01/...` is served by the newest older registration, with the requested date in the header). `latest` serves the newest registrations. `preview` is separate and never part of `latest`. An unknown namespace — a non-date, an impossible date, a date before the first registration, or no version segment at all — answers 404 from the namespace guards.

Every response carries `X-API-Version-Status` (`stable` | `latest` | `preview`) and, on versioned mounts, `X-API-Version` naming the namespace that was asked for. Both are set in a `finally`, so validation errors and 410 withdrawals carry them too.

## OpenAPI documentation

The document publishes **every dated version plus `latest`** of each documented endpoint, so a pinned client sees the schemas its version actually serves — and never `preview`, never a bare path. An endpoint is documented when its chain declares `withOutput` or `withDocs` and does not set `docs.hide: true`; withdrawn endpoints leave the document at the version they were withdrawn from. Set `docs.operationId` explicitly on every documented endpoint: generated ids leak URL shapes into SDK function names. `latest` keeps that declared id, while each dated mount appends its version (for example, `createThing_2026_08_07`) so operation ids remain unique across the document.

Hosts generate framework service specs with `generateApiSpecs` exported by `@langwatch/api/rest`, and MUST pass `excludeStaticFile: false`. hono-openapi stores route metadata under a package-local symbol, so importing its generator separately may not see framework routes when the workspace resolves two peer variants. A dotted, parameterless path is also dropped by hono-openapi's default filter as a static file, silently. The traps are pinned by the package tests and the application spec-generation task.

## Capabilities are ports

Rate limiting and response caching need a substrate the framework may not own, so the package declares the contracts and the application supplies implementations on `createService({ rateLimiter, cache })` (see `ports.ts`). Declaring `.withRateLimit()` without a rate limiter, or `.withCache(...)` without a cache, **fails the build**, naming the endpoint and the missing port — a capability that silently does nothing is worse than no capability. `withCache` without `withOutput` also fails the build: unvalidated bytes may not be cached.

The pipeline positions are fixed: rate limit after auth, before validation (429 + `Retry-After` when the limiter supplies one); cache read after validation, before the handler. The framework owns the keys: service + endpoint + version namespace + principal for the limiter; endpoint + version namespace + a hash of the complete validated input for the cache. A cache failure degrades to a handler call and is logged; a limiter failure is logged and propagated.

`withDeprecated(notice)` needs no port: the operation is marked `deprecated: true` with the notice in its description on every dated mount, and live responses carry `Deprecation` + `X-API-Deprecation-Notice` headers — errors included (same `finally` as the version headers).

## SSE streaming

`registerSse` mounts a dotted name as a GET. A stream has no request body and no path params, so the chain offers neither; request data arrives through `withQuery` and is read as `c.get("query")`. The handler takes `(c, stream)`; `stream.emit()` validates the payload against its declared event schema, and on failure writes an `error` event carrying the issues and rejects — so the handler must catch to continue streaming. A handler error propagates to the service error handler, and client disconnect settles the stream's completion rather than leaking it.

```ts
.registerSse("things.watch", "2026-08-07", async (c, stream) => {
  const { channel } = c.get("query") as { channel: string };
  await stream.emit("ready", { channel });
  stream.close();
}, (b) =>
  b
    .withQuery(z.object({ channel: z.string() }))
    .withEvents({ ready: z.object({ channel: z.string() }) }),
);
```

## Route mounting callback

`onRouteMounted` fires synchronously during `build()` for every route the service mounts, so a host can register route policies (authorization registries, coverage gates) without re-deriving the route table:

| Field              | Meaning                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `method`           | Mounted HTTP method. SSE endpoints report `"get"`, guards `"all"`.                                                 |
| `path`             | Absolute path including the base path, byte-identical to what the Hono route table (`app.routes[i].path`) reports. |
| `version`          | `"2026-08-07"`, `"latest"`, `"preview"`, or `null` for the guards.                                                 |
| `status`           | `"stable"`, `"latest"`, `"preview"`, or `null` for the guards.                                                     |
| `withdrawn`        | `true` for mounts answering 410 Gone. Their `config` is the inherited one, `meta` included.                        |
| `isNamespaceGuard` | `true` for the two version-namespace catch-alls.                                                                   |
| `config`           | The resolved endpoint definition behind the mount; `null` for guards.                                              |

Completeness is the point: every dated version, `latest`, `preview`, withdrawn (410) endpoints, and both version-namespace guards report. A policy registry that fails on unknown routes must receive all of them.

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

The `app` export is a standard Hono instance. Test with `app.request()` against a versioned namespace:

```ts
const res = await app.request("/api/things/2026-08-07/things.create", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({ name: "widget" }),
});
expect(res.status).toBe(201);
```

Unit tests: `pnpm --filter @langwatch/api test:unit`

## File structure

```
src/
  index.ts                # "." -- the transport-agnostic entry point
  errors.ts               # HandledError subclasses, the wire envelope, createErrorHandler
  access-policy.ts        # What credential an operation accepts, and what it can reach
  ports.ts                # RateLimiter + ResponseCache capability ports (the app supplies the substrate)
  schema.ts               # The Standard Schema boundary (parse, issue shape, flatten)

  rest/
    index.ts              # "./rest" -- the Hono service framework, plus routeHandlers() for legacy Next-style hosts
    builder.ts            # createService(), createRestService(), ServiceBuilder, GroupRegistrar
    definition.ts         # The definition chain (withInput/withOutput/withStatus/withAuth/...), precedence merge, status invariant
    capabilities.ts       # Rate-limit and cache middleware (keys, 429, validated-bytes caching, failure degradation)
    versioning.ts         # Version catalogue from registrations; forward-copy + withdrawal resolution
    route-mounting.ts     # Mounts dated/latest/preview namespaces + guards; date-namespace fallback; onRouteMounted
    pipeline.ts           # Per-endpoint middleware stack (auth, rate limit, docs, validation, cache read, handler)
    public-rest-routing.ts, public-rest-input.ts, rest-version-selector.ts
    response.ts           # Output validation + serialization
    middleware.ts         # Built-in tracer + logger (uses @langwatch/observability)
    sse.ts                # registerSse() typed event stream
    types.ts              # ServiceConfig, EndpointDef, EndpointDocs, MountedRoute, ServiceContext, ...
    security/             # Route-policy registry, OpenAPI security projection, SecuredApp

  trpc/
    index.ts              # "./trpc" -- the tRPC root and policy spine
    trpc-root.ts          # TrpcRootDefinition: a typed root that keeps context and input concrete
    trpc-permission-builder.ts   # After .input(), no .query/.mutation until authorization is declared
    trpc-declared-authz.ts       # permission / permissionAny / noPermission / authorizeInService
    trpc-runtime-policy.ts, trpc-policy-ports.ts, trpc-policy-context.ts
    trpc-audit.ts, trpc-audit-redaction.ts    # The audit trail and its action-keyed redaction table
    trpc-call-logging.ts, trpc-caller-trace.ts, trpc-failure-trace.ts, trpc-error-formatter.ts
    trpc-scope-lineage.ts
```

## LLM instructions

When creating a new API service using this framework:

1. Create `src/app/api/{name}/[[...route]]/app.ts` exporting the built app: `export const app = createService({ name })...build()`
2. Mount it in `src/server/api-router.ts` with `api.route("/", app)` next to the other services (do not create a `route.ts`; `routeHandlers()` is only for legacy Next-style hosts)
3. Use `createService({ name })` from `@langwatch/api/rest`, with the service name matching the URL path segment
4. Pass auth and organization middleware through `createService({ auth, _legacy: { organizationMiddleware } })`; pass capability ports through `createService({ rateLimiter, cache })` when any endpoint declares them — declaring without the port fails the build
5. Use `createRestService().get/post/put/patch/delete` for new public REST, compatibility `registerRoute` for existing HTTP, and `registerSse` for streams
6. Compose one application instance at process boot and expose it as `context.app`; expose the authenticated request principal as `context.actor()`. Feature handlers must not construct or resolve services per request. Handler signature is `(context, input)`; REST path, query and body fields are already merged into `input`
7. Declare capabilities on the definition chain. Public REST has one `withInput` and one `withOutput`; compatibility HTTP retains `withParams`/`withQuery`
8. Handlers return raw data when `withOutput` is declared; the framework validates and serializes
9. Throw `NotFoundError` / `HandledError` for error responses, never a manual `c.json({ error }, 404)`
10. Test the URL family you declared: `/api/{name}/{date|latest}/...` for `createService`, or `/api/v1/{name}/{optional date|latest}/...` for public REST
11. Every mount reports through `onRouteMounted`, including withdrawn endpoints and both version-namespace guards
