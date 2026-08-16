# @langwatch/api

Builder for versioned Hono API services. Handles middleware stacking, input/output validation, OpenAPI docs, error formatting, and date-based versioning with forward-copying.

Built on top of [Hono](https://hono.dev), [hono-openapi](https://github.com/rhinobase/hono-openapi), and Zod.

## Quick start

A service is one file exporting a built Hono app:

```ts
// src/app/api/things/[[...route]]/app.ts
import { z } from "zod";
import { createService } from "@langwatch/api";
import { authMiddleware } from "../../middleware/auth";
import { organizationMiddleware } from "../../middleware/organization";
import { ThingService } from "~/server/things/thing.service";
import { prisma } from "~/server/db";

const thingSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const app = createService({
  name: "things",
  auth: authMiddleware,
  _legacy: { organizationMiddleware },
})
  .provide({
    thingService: () => ThingService.create(prisma),
  })
  .version("2025-03-15", (v) => {
    v.get(
      "/",
      {
        output: z.array(thingSchema),
        description: "Lists every thing in the project.",
        docs: { operationId: "listThings", tags: ["Things"] },
      },
      async (_c, { app }) => {
        return app.thingService.getAll({ projectId: app.project.id });
      },
    );

    v.post(
      "/",
      {
        input: z.object({ name: z.string().min(1) }),
        output: thingSchema,
        status: 201,
        docs: { operationId: "createThing", tags: ["Things"] },
      },
      async (_c, { input, app }) => {
        return app.thingService.create({ projectId: app.project.id, ...input });
      },
    );

    v.get(
      "/:id",
      {
        params: z.object({ id: z.string() }),
        output: thingSchema,
        docs: { operationId: "getThing", tags: ["Things"] },
      },
      async (_c, { params, app }) => {
        return app.thingService.getById({
          id: params.id,
          projectId: app.project.id,
        });
      },
    );
  })
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

## What it does for you

- **Tracing + logging** via `@langwatch/observability` (automatic, disable with `tracer: false` / `logger: false`)
- **Auth, org, resource limits** applied in the right order per-endpoint
- **Input/output/params/query validation** from Zod schemas on every mount
- **OpenAPI documentation** of the bare alias path only, shaped by `docs`
- **Error formatting + logging** for `HandledError` (code, meta, reasons, traceId/spanId, fault/tips/docsUrl) and Zod errors
- **Versioned routing** at `/api/{name}/{date}/...` with forward-copying from previous versions
- **Route mounting callback** (`onRouteMounted`) so hosts can register route policies for every mounted path, namespace guards included

## Handler signature

```ts
v.get("/path", config, async (c, { input, params, query, app }) => {
  // c        = Hono Context (escape hatch for headers, raw request)
  // input    = parsed JSON body (from config.input schema)
  // params   = parsed path params (from config.params schema)
  // query    = parsed query string (from config.query schema)
  // app      = { project, _legacy: { organization, prisma }, ...providers }

  return data; // framework validates against config.output and calls c.json()
});
```

When `output` is defined, return raw data. The framework validates + serializes; a handler response that violates its output contract is reported as an internal server error.
When `output` is not defined, return a Hono `Response` directly.

## Endpoint config

Second argument to `v.get()`, `v.post()`, etc:

```ts
{
  input: z.object({ ... }),         // JSON body schema
  output: z.object({ ... }),        // Response schema (validates + OpenAPI)
  params: z.object({ id: z.string() }), // Path params
  query: z.object({ limit: z.number() }), // Query string
  description: "...",               // OpenAPI description
  docs: { operationId: "..." },      // OpenAPI documentation options (below)
  status: 201,                      // HTTP status (default 200)
  auth: "none",                     // Skip auth and legacy org resolution
  resourceLimit: "scenarios",       // Enforce resource limits
  middleware: [rateLimiter()],       // Extra per-endpoint middleware
  meta: { policy: ... },             // Opaque, surfaced on onRouteMounted
}
```

All fields optional. Pass `{}` for a bare endpoint. Endpoint paths must be empty or begin with `/`. Declaring `resourceLimit` without a service-level `_legacy.resourceLimitMiddleware` fails the build rather than silently disabling the limit.

`meta` is never read by the framework: it travels on `MountedRoute.config` so `onRouteMounted` consumers (route policy registries, gates) can act on per-endpoint declarations.

## OpenAPI documentation

**Only the bare alias path is documented.** `generateSpecs(app)` (hono-openapi) yields exactly one path per endpoint, without a version segment (`/api/things`, `/api/things/{id}`). Dated, `latest`, and `preview` mounts serve traffic and set version headers but never reach the document, and withdrawn endpoints are never documented. An endpoint reaches the document only when it declares something documentable (`output`, `description`, or `docs`) and is not hidden.

`docs` shapes the documented operation:

```ts
v.get(
  "/",
  {
    output: z.array(thingSchema),
    description: "Lists every thing in the project.",
    docs: {
      summary: "List things",
      tags: ["Things"],
      operationId: "listThings",
      security: [{ bearerAuth: [] }],
      responses: { "404": { description: "Thing not found" } },
    },
  },
  handler,
);
```

- The success response is generated from `output` and `status`; `docs.responses` merges over it (same-status keys win).
- `docs.hide: true` removes the endpoint from the document entirely; the route keeps serving.
- Set `docs.operationId` explicitly on every documented endpoint: generated ids leak URL shapes into SDK function names.
- Validation is not documentation. `params`/`query`/`input` schemas keep validating on every mount, so a bad body 422s at `/api/things/2025-03-15/` exactly as it does at `/api/things`.

## Route mounting callback

`onRouteMounted` fires synchronously during `build()` for every route the service mounts, so a host can register route policies (authorization registries, coverage gates) without re-deriving the route table:

```ts
createService({
  name: "things",
  onRouteMounted: (route) => registerRoutePolicy(route),
});
```

Each callback receives a `MountedRoute`:

| Field | Meaning |
| --- | --- |
| `method` | Mounted HTTP method. SSE endpoints report `"get"`, namespace guards `"all"`. |
| `path` | Absolute path including the base path, byte-identical to what the Hono route table (`app.routes[i].path`) reports. |
| `version` | `"2025-03-15"`, `"latest"`, `"preview"`, or `null` for the bare alias and the guards. |
| `status` | `"stable"`, `"latest"`, `"preview"`, or `"unversioned"`. |
| `withdrawn` | `true` for mounts answering 410 Gone. Their `config` is the inherited one, `meta` included. |
| `namespaceGuard` | `true` for the two version-namespace catch-alls. |
| `config` | The endpoint config behind the mount; `null` for the guards. |

Completeness is the point: every dated version, `latest`, `preview`, the bare alias, withdrawn (410) endpoints, and both version-namespace guards report. The non-wildcard guard (`/:apiVersion{latest|preview|20\d{2}-\d{2}-\d{2}}`) is a real, enumerable route: a policy registry that fails on unknown routes must receive it.

## Versioning

Versions are real `YYYY-MM-DD` calendar dates. Invalid or duplicate versions fail at registration instead of being silently ignored. Each version inherits all endpoints from the previous one. Override or add endpoints, and use `withdraw()` to remove.

```ts
.version("2025-03-15", (v) => {
  v.get("/", { output: listSchema }, handler);
  v.post("/", { input: createSchema, output: itemSchema }, handler);
})
.version("2025-09-01", (v) => {
  // Override POST with new input schema
  v.post("/", { input: newCreateSchema, output: itemSchema }, newHandler);
  // Remove GET /:id (returns 410 Gone)
  v.withdraw("get", "/:id");
  // GET / is inherited from 2025-03-15 automatically
})
```

URL structure:

| URL                       | Resolves to                         |
| ------------------------- | ----------------------------------- |
| `/api/things/2025-03-15/` | Exact version                       |
| `/api/things/2025-09-01/` | Exact version                       |
| `/api/things/latest/`     | Most recent dated version           |
| `/api/things/`            | Same as latest (backwards compat)   |
| `/api/things/preview/`    | Preview endpoints (never in latest) |

### Version headers

Every response carries `X-API-Version-Status` (`stable`, `latest`, `preview`, or `unversioned`), and versioned mounts additionally carry `X-API-Version` with the namespace they answered from (`2025-03-15`, `latest`, `preview`). Bare-path requests get only the status header. The headers are set in a `finally`, so validation errors and 410 withdrawals carry them too.

The first path segment is reserved when it is `latest`, `preview`, or a date-shaped version. This prevents a missing versioned route from falling through to a dynamic unversioned endpoint.

## Providers

`.provide()` injects services into handlers via `app.*`. Factories receive the base context and resolve concurrently, so there are no cross-provider dependencies. Provider factories run after any enabled auth and organization middleware, with the resolved request context available to logging. Endpoints using `auth: "none"` skip both the service auth and legacy organization middleware. The `project` and `_legacy` names are reserved for the base context.

```ts
.provide({
  thingService: () => ThingService.create(prisma),
  cache: async (base) => CacheService.forProject(base.project.id),
})
```

`app.thingService` and `app.cache` are fully typed from the factory return types.

## SSE streaming

SSE endpoints are GET routes. Use `query` for request data; JSON request bodies are intentionally unsupported. `stream.emit()` validates and serializes the parsed payload. On validation failure it emits an `error` event and rejects, so the handler must explicitly catch the error if it wants to continue streaming.

```ts
v.sse(
  "/execute",
  {
    events: {
      result: z.object({ score: z.number() }),
      error: z.object({ message: z.string() }),
    },
    query: querySchema,
  },
  async (c, { query, app }, stream) => {
    await stream.emit("result", { score: 0.95 }); // validated against schema
    stream.close();
  },
);
```

## RPC endpoints

`v.rpc()` registers an RPC-named endpoint: a dotted `<resource>.<verb>` path that mounts as a real POST. The name carries the verb, so the HTTP method never does. See [ADR-094](../../dev/docs/adr/094-rpc-endpoint-naming.md) — this is a **pilot on the `webhooks` family**, not the default for new services. The four resource-REST management families stay as they are; use `v.get`/`v.post`/... unless you are extending `webhooks`.

```ts
v.rpc(
  "/endpoints.rollSecret",
  {
    ...guard("webhookEndpoints:manage"),
    input: z.object({ id: z.string() }),
    output: endpointWithSecretSchema,
    docs: { operationId: "rollWebhookEndpointSecret" },
  },
  async (_c, { input, app }) => app.endpoints.rollSecret({ id: input.id }),
);
```

Three rules, all load-bearing:

- **Every argument travels in the JSON body.** No path params, no query string — which is what puts zod on identifiers that a REST `:id` left unvalidated.
- **An RPC with no required arguments declares no `input`**, and its handler ignores the body. The pipeline only installs the json validator when `input` is present, so a bodyless POST and a `{}` POST both succeed. Writing `input: z.object({}).optional()` instead reinstates the parse and rejects the bodyless call.
- **Reads are POST too.** Uniform method is the point; it also forecloses HTTP caching, which is acceptable for an API-key-only management surface and would not be on a high-volume read surface.

The grammar is asserted at registration, so a bad name fails the build rather than review:

```text
^/[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$   →  /endpoints.rollSecret   ✓
                                                /endpoints/:id          ✗
                                                /endpoints.Roll_Secret  ✗
```

Versioning, forward-copying and withdrawal need no special handling: endpoint identity is `` `${method}:${path}` ``, so `post:/endpoints.create` is unique and `v.withdraw("post", "/endpoints.create")` works unmodified.

## Error handling

Throw `HandledError` subclasses (from `@langwatch/handled-error`). The framework:

1. Catches and serializes them with `code`, `meta`, `reasons`, `traceId`/`spanId`,
   plus the remediation channel (`fault`, `tips`, `docsUrl`)
2. Catches `ZodError` and promotes it to a `ValidationError`, mapping each issue
   to a `schema_failure` reason
3. Returns union format for unversioned requests (includes legacy `error` field)
4. Returns clean format for versioned requests
5. Publishes the error it sent, and the status it sent it as, for the request
   logger to consume

The request logger writes **exactly one** error record per failed request.
Level comes from `fault` when the error is handled (`customer` → warn,
`platform` / `provider` → error) and from the status code otherwise (5xx →
error, 4xx → warn) — so an unknown error, which is flattened to a 500, logs at
`error` with its cause, while an unhandled `HTTPException` carrying a 4xx logs
at `warn`. The error handler deliberately logs
nothing itself: a second record there would double every error-log-derived
alert and count. It publishes the *promoted* error, so a `ZodError` is reported
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

The `app` export is a standard Hono instance. Test with `app.request()`:

```ts
const res = await app.request("/api/things", {
  headers: { "X-Auth-Token": apiKey },
});
expect(res.status).toBe(200);
```

Unit tests: `pnpm --filter @langwatch/api test:unit`

## File structure

```
src/
  builder.ts          # createService(), ServiceBuilder
  version-builder.ts  # VersionBuilder (v.get/post/..., v.sse(), v.withdraw())
  versioning.ts       # Forward-copy algorithm + request-time resolution
  route-mounting.ts   # Mounts versions, guards, bare alias; fires onRouteMounted
  pipeline.ts         # Per-endpoint middleware stack (auth, docs, validation, handler)
  response.ts         # Output validation + serialization
  middleware.ts       # Built-in tracer + logger (uses @langwatch/observability)
  errors.ts           # Error handler (HandledError, ZodError, version-gated format)
  sse.ts              # v.sse() with typed events
  types.ts            # ServiceConfig, EndpointConfig, EndpointDocs, MountedRoute, ...
  index.ts            # Public re-exports + routeHandlers() (legacy Next-style hosts)
```

## LLM instructions

When creating a new API service using this framework:

1. Create `src/app/api/{name}/[[...route]]/app.ts` exporting the built app: `export const app = createService({ name })...build()`
2. Mount it in `src/server/api-router.ts` with `api.route("/", app)` next to the other services (do not create a `route.ts`; `routeHandlers()` is only for legacy Next-style hosts)
3. Use `createService({ name })` with the service name matching the URL path segment
4. Pass auth and organization middleware through `createService({ auth, _legacy: { organizationMiddleware } })`
5. Use `.provide()` for service-layer dependencies: factories get `{ project, _legacy: { organization, prisma } }`
6. Define Zod schemas for input/output/params next to the service, not in a shared types file
7. Handlers return raw data when `output` is set; the framework validates and serializes
8. Throw `NotFoundError` / `HandledError` for error responses, never a manual `c.json({ error }, 404)`
9. Use `status: 201` in endpoint config for creation endpoints
10. Set `docs: { operationId, tags }` on every documented endpoint; only the bare alias path reaches the OpenAPI document, and endpoints without `output`, `description`, or `docs` stay out of it
11. When the host keeps a route policy registry, declare the policy in `meta` and register it via `onRouteMounted`; every mount reports, including withdrawn endpoints and both version-namespace guards
