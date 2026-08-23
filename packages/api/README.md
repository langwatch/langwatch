# @langwatch/api

The contract-sealed service framework for LangWatch API services: RPC-first endpoint registration, explicit version namespaces, input/output validation, OpenAPI documentation, capability ports, SSE streaming, and error formatting.

Built on top of [Hono](https://hono.dev) and [hono-openapi](https://github.com/rhinobase/hono-openapi). Its schema boundary is [Standard Schema](https://standardschema.dev/): new feature contracts use Zod 4, while existing application routes can migrate from Zod 3 independently.

The lasting decisions live in [adrs/](./adrs) — [001 RPC-first fluent registration](./adrs/001-rpc-first-fluent-registration.md), [002 explicit version namespaces](./adrs/002-explicit-version-namespaces.md), [003 endpoint capabilities are ports](./adrs/003-endpoint-capabilities-are-ports.md) — and the behavioural contracts in [specs/](./specs). This README is usage; rationale stays there.

## Quick start

A service is one file exporting a built Hono app. An endpoint is one `register` call carrying its name, its version, its handler and its definition chain:

```ts
// src/app/api/things/[[...route]]/app.ts
import { z } from "zod";
import { createService } from "@langwatch/api";
import { authMiddleware } from "../../middleware/auth";
import { organizationMiddleware } from "../../middleware/organization";
import { ThingService } from "~/server/things/thing.service";
import { prisma } from "~/server/db";

const thingSchema = z.object({ id: z.string(), name: z.string() });

export const app = createService({
  name: "things",
  auth: authMiddleware,
  _legacy: { organizationMiddleware },
})
  .provide({
    things: () => ThingService.create(prisma),
  })
  .register(
    "things.create",
    "2026-08-07",
    async (c, input: { name: string }) => c.get("things").create(c, input),
    (b) =>
      b
        .withInput(z.object({ name: z.string().min(1) }))
        .withOutput(thingSchema)
        .withStatus(201)
        .withDocs({ operationId: "createThing", tags: ["Things"] }),
  )
  .register(
    "things.list",
    "2026-08-07",
    async (c) => c.get("things").getAll(),
    (b) =>
      b
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

## The three registration methods

- **`register(name, version, handler, define?)`** — an RPC endpoint. The name is an identifier, not a URL: slash-less, dotted lower-camelCase, at least one dot — `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`, so `things.create` ✓ and `/things.create`, `things/:id`, `things.RollSecret` ✗. The grammar is checked twice: by the types in the editor and by an assert at registration, with one test table (`rpc-types.unit.test.ts`) driving both. Every RPC is a POST, reads included, and every argument travels in the JSON body via `withInput` — `withParams`/`withQuery` are not offered on the RPC chain, and declaring them behind an `any` fails registration. An RPC with no required arguments declares no `withInput`: the pipeline installs the JSON validator only when input is declared, so a bodyless POST and a `{}` POST both succeed.
- **`registerRoute(method, path, version, handler, define?)`** — the existing resource-REST management families. Paths are used as-is; new families do not use it.
- **`registerSse(name, version, handler, define?)`** — a dotted name mounted as a GET, with `.withEvents({...})` / `.withQuery(...)`. See SSE streaming below.
- **`withdraw(name, version)`** — answers 410 Gone from that version onward, on every mount, with the withdrawn endpoint's config still on the mount report.

`isRpcPath` exports the name grammar for consumers that must recognise an RPC name after the fact — the discovery catalogues ask it rather than writing a second regex that agrees until one of them changes.

## The handler contract

Handlers are positional: `(c, input)` — the Hono context and the validated input. There is no destructured bag. Everything else arrives as typed context variables:

```ts
.registerRoute("patch", "/:id", "2026-08-07", async (c, input: UpdateThing) => {
  const things = c.get("things");          // typed from .provide()
  const params = c.get("params") as { id: string };  // validated by withParams
  const query = c.get("query");            // validated by withQuery
  // ...
}, (b) => b.withParams(idParams).withInput(updateThingSchema).withOutput(thingSchema));
```

One honesty note on types: `input` is declared on the definition chain, which is the argument _after_ the handler — TypeScript checks arguments in order, so the chain cannot flow back into the handler's parameter type. Annotate `input` (or delegate to a typed domain function) as above; the declared schema is always the runtime guarantee. `params` and `query` are typed loosely for the same reason. An endpoint registered without a chain gets `input: undefined` — that one is enforced by an overload.

When `withOutput` is declared, return raw data: the framework validates and serializes (a handler response that violates its own output contract is a 500 — our bug, not the caller's). Without it, return a Hono `Response` directly and own the status outright. An endpoint answers ONE success status: `withStatus(201)` or 200 by default, 204 for a `z.void()` / `z.undefined()` output. An output schema that accepts both `undefined` and a value is refused at registration, because that is what used to let the status move per request.

## The definition chain

The chain is the only extension point — a new capability is a new chain call and never changes the registration signature:

```ts
(b) => b
  .withInput(z.object({ ... }))        // JSON body schema (not on SSE)
  .withOutput(thingSchema)             // response schema: validates + OpenAPI (not on SSE)
  .withParams(z.object({ id: z.string() }))   // path params (registerRoute only)
  .withQuery(z.object({ limit: z.coerce.number() }))  // query string (registerRoute, registerSse)
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

A `.withX()` on the service builder is the default for every endpoint; endpoint re-declaration wins; middleware stacks. `service.group(name, define?)` returns a registrar (`register`/`registerSse`/`registerRoute`/`withdraw`) whose chain declares defaults for everything registered through it, prefixing dotted names (`things.register("create", ...)` → `things.create`, grammar-checked on the full name). Precedence runs service < group < endpoint. Groups do not nest and carry no version.

## Versioning

Every API URL names its version namespace; there is no bare alias:

```text
/api/{service}/{YYYY-MM-DD|latest|preview}/{name}
```

The version catalogue is the union of versions named in `register` calls. An endpoint serves at version V its latest registration dated on or before V — including a real date nobody registered (`/api/things/2026-03-01/...` is served by the newest older registration, with the requested date in the header). `latest` serves the newest registrations. `preview` is separate and never part of `latest`. An unknown namespace — a non-date, an impossible date, a date before the first registration, or no version segment at all — answers 404 from the namespace guards.

Every response carries `X-API-Version-Status` (`stable` | `latest` | `preview`) and, on versioned mounts, `X-API-Version` naming the namespace that was asked for. Both are set in a `finally`, so validation errors and 410 withdrawals carry them too.

## OpenAPI documentation

The document publishes **every dated version plus `latest`** of each documented endpoint, so a pinned client sees the schemas its version actually serves — and never `preview`, never a bare path. An endpoint is documented when its chain declares `withOutput` or `withDocs` and does not set `docs.hide: true`; withdrawn endpoints leave the document at the version they were withdrawn from. Set `docs.operationId` explicitly on every documented endpoint: generated ids leak URL shapes into SDK function names. `latest` keeps that declared id, while each dated mount appends its version (for example, `createThing_2026_08_07`) so operation ids remain unique across the document.

Hosts generate framework service specs with `generateApiSpecs` exported by `@langwatch/api`, and MUST pass `excludeStaticFile: false` for RPC endpoints. hono-openapi stores route metadata under a package-local symbol, so importing its generator separately may not see framework routes when the workspace resolves two peer variants. Every RPC name is also dotted and parameterless, so hono-openapi's default filter drops the family as static files, silently. The traps are pinned by the package tests and the application spec-generation task.

## rpc.discover

Every service serves its own RPC catalogue at `POST /api/{service}/{version}/rpc.discover`, mounted by `build()` under every version namespace and derived from the same registrations the document is generated from — a projection, not a registry, so it cannot report an operation that does not exist or disagree about a schema. Per operation: `name`, `path`, `operationId?`, `summary?`, `description?`, `input`/`output` JSON Schemas (or `null`), and `status`. The documented-only rule is the document's own: an operation reaches the catalogue exactly when it would reach the document, so a preview catalogue is empty and a hidden endpoint is nowhere. A catalogue is meta: never documented itself, and no catalogue lists another. Set `openapiUrl` on the service config and each catalogue points back at the full document.

The platform's root `POST /api/rpc.discover` is the second level: it lists every service with the URL of that service's catalogue, and repeats no operation.

## Capabilities are ports

Rate limiting and response caching need a substrate the framework may not own, so the package declares the contracts and the application supplies implementations on `createService({ rateLimiter, cache })` (see `ports.ts`). Declaring `.withRateLimit()` without a rate limiter, or `.withCache(...)` without a cache, **fails the build**, naming the endpoint and the missing port — a capability that silently does nothing is worse than no capability. `withCache` without `withOutput` also fails the build: unvalidated bytes may not be cached.

The pipeline positions are fixed: rate limit after auth, before validation (429 + `Retry-After` when the limiter supplies one); cache read after validation, before the handler. The framework owns the keys: service + endpoint + version namespace + principal for the limiter; endpoint + version namespace + a hash of the validated input body for the cache. A cache failure degrades to a handler call and is logged; a limiter failure is logged and propagated.

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

| Field                | Meaning                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `method`             | Mounted HTTP method. SSE endpoints report `"get"`, guards `"all"`, catalogues `"post"`.                            |
| `path`               | Absolute path including the base path, byte-identical to what the Hono route table (`app.routes[i].path`) reports. |
| `version`            | `"2026-08-07"`, `"latest"`, `"preview"`, or `null` for the guards.                                                 |
| `status`             | `"stable"`, `"latest"`, `"preview"`, or `null` for the guards.                                                     |
| `withdrawn`          | `true` for mounts answering 410 Gone. Their `config` is the inherited one, `meta` included.                        |
| `isNamespaceGuard`   | `true` for the two version-namespace catch-alls.                                                                   |
| `isDiscoverEndpoint` | `true` for the `rpc.discover` catalogue mounts.                                                                    |
| `config`             | The resolved endpoint definition behind the mount; `null` for guards and catalogues.                               |

Completeness is the point: every dated version, `latest`, `preview`, withdrawn (410) endpoints, the catalogue mounts, and both version-namespace guards report. A policy registry that fails on unknown routes must receive all of them.

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
  builder.ts          # createService(), ServiceBuilder, GroupRegistrar
  definition.ts       # The definition chain (withInput/withOutput/withStatus/withAuth/...), precedence merge, status invariant
  rpc-name.ts         # The RPC name grammar: RpcName<T> type + assertRpcName, one rule stated twice
  ports.ts            # RateLimiter + ResponseCache capability ports (app supplies the substrate)
  capabilities.ts     # Rate-limit and cache middleware (keys, 429, validated-bytes caching, failure degradation)
  discover.ts         # rpc.discover: the per-service RPC catalogue projection
  versioning.ts       # Version catalogue from registrations; forward-copy + withdrawal resolution
  route-mounting.ts   # Mounts dated/latest/preview namespaces + discover + guards; date-namespace fallback; onRouteMounted
  pipeline.ts         # Per-endpoint middleware stack (auth, rate limit, docs, validation, cache read, handler)
  response.ts         # Output validation + serialization
  middleware.ts       # Built-in tracer + logger (uses @langwatch/observability)
  errors.ts           # Error handler (HandledError, ZodError; one clean format)
  sse.ts              # registerSse() typed event stream
  types.ts            # ServiceConfig, EndpointDef, EndpointDocs, MountedRoute, ServiceContext, ...
  index.ts            # Public re-exports + routeHandlers() (legacy Next-style hosts)
```

## LLM instructions

When creating a new API service using this framework:

1. Create `src/app/api/{name}/[[...route]]/app.ts` exporting the built app: `export const app = createService({ name })...build()`
2. Mount it in `src/server/api-router.ts` with `api.route("/", app)` next to the other services (do not create a `route.ts`; `routeHandlers()` is only for legacy Next-style hosts)
3. Use `createService({ name })` with the service name matching the URL path segment
4. Pass auth and organization middleware through `createService({ auth, _legacy: { organizationMiddleware } })`; pass capability ports through `createService({ rateLimiter, cache })` when any endpoint declares them — declaring without the port fails the build
5. Default to `register(name, version, handler, define?)` with a dotted lower-camelCase name; `registerRoute` is for the existing REST management families, `registerSse` for streams. Every registration names its version explicitly
6. Use `.provide()` for service-layer dependencies and read them as typed context variables (`c.get("things")`); read validated `params`/`query` via `c.get(...)`. Handler signature is `(c, input)` — annotate `input` with the schema's inferred type
7. Declare capabilities on the definition chain: `withInput`/`withOutput`/`withParams`/`withQuery`, `withStatus(201)` on creation endpoints, `withDocs({ operationId, tags })` on every documented endpoint, `withMeta({ policy })` when the host keeps a route policy registry
8. Handlers return raw data when `withOutput` is declared; the framework validates and serializes
9. Throw `NotFoundError` / `HandledError` for error responses, never a manual `c.json({ error }, 404)`
10. Versioned mounts document every dated version plus `latest`; there is no bare alias, so test and call `/api/{name}/{date|latest}/...` URLs
11. Every mount reports through `onRouteMounted`, including withdrawn endpoints, the rpc.discover catalogue mounts, and both version-namespace guards
