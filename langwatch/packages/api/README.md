# @langwatch/api

Builder for versioned Hono API services. Handles middleware stacking, input/output validation, OpenAPI docs, error formatting, and date-based versioning with forward-copying.

Built on top of [Hono](https://hono.dev), [hono-openapi](https://github.com/rhinobase/hono-openapi), and Zod.

## Quick start

Two files per service. The service definition:

```ts
// src/app/api/things/[[...route]]/things.service.ts
import { z } from "zod";
import { createService, routeHandlers } from "@langwatch/api";
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
    v.get("/", { output: z.array(thingSchema) }, async (_c, { app }) => {
      return app.thingService.getAll({ projectId: app.project.id });
    });

    v.post(
      "/",
      {
        input: z.object({ name: z.string().min(1) }),
        output: thingSchema,
        status: 201,
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
      },
      async (_c, { params, app }) => {
        return app.thingService.getById({ id: params.id, projectId: app.project.id });
      },
    );
  })
  .build();

export const { GET, POST, PUT, DELETE } = routeHandlers(app);
```

The Next.js route file:

```ts
// src/app/api/things/[[...route]]/route.ts
export { GET, POST, PUT, DELETE } from "./things.service";
```

## What it does for you

- **Tracing + logging** via `@langwatch/telemetry` (automatic, disable with `tracer: false` / `logger: false`)
- **Auth, org, resource limits** applied in the right order per-endpoint
- **Input/output/params/query validation** from Zod schemas, auto-wired to OpenAPI
- **Error formatting** that duck-types `DomainError` (kind, meta, reasons, telemetry) and catches Zod errors
- **Versioned routing** at `/api/{name}/{date}/...` with forward-copying from previous versions

## Handler signature

```ts
v.get("/path", config, async (c, { input, params, query, app }) => {
  // c        = Hono Context (escape hatch for headers, raw request)
  // input    = parsed JSON body (from config.input schema)
  // params   = parsed path params (from config.params schema)
  // query    = parsed query string (from config.query schema)
  // app      = { project, organization, prisma, ...providers }

  return data; // framework validates against config.output and calls c.json()
});
```

When `output` is defined, return raw data. The framework validates + serializes.
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
  status: 201,                      // HTTP status (default 200)
  auth: "none",                     // Skip auth for this endpoint
  resourceLimit: "scenarios",       // Enforce resource limits
  middleware: [rateLimiter()],       // Extra per-endpoint middleware
}
```

All fields optional. Pass `{}` for a bare endpoint.

## Versioning

Versions are dates. Each version inherits all endpoints from the previous one. Override or add endpoints, and use `withdraw()` to remove.

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

| URL | Resolves to |
|-----|-------------|
| `/api/things/2025-03-15/` | Exact version |
| `/api/things/2025-09-01/` | Exact version |
| `/api/things/latest/` | Most recent dated version |
| `/api/things/` | Same as latest (backwards compat) |
| `/api/things/preview/` | Preview endpoints (never in latest) |

Response headers: `X-API-Version` and `X-API-Version-Status` (stable/latest/preview/unversioned).

## Providers

`.provide()` injects services into handlers via `app.*`. Factories receive the base context. No cross-provider dependencies.

```ts
.provide({
  thingService: () => ThingService.create(prisma),
  cache: async (base) => CacheService.forProject(base.project.id),
})
```

`app.thingService` and `app.cache` are fully typed from the factory return types.

## SSE streaming

```ts
v.sse("/execute", {
  events: {
    result: z.object({ score: z.number() }),
    error: z.object({ message: z.string() }),
  },
  input: executeSchema,
}, async (c, { input, app }, stream) => {
  await stream.emit("result", { score: 0.95 }); // validated against schema
  stream.close();
});
```

## Error handling

Throw `DomainError` subclasses (from `~/server/app-layer/domain-error`). The framework:

1. Catches and serializes them with `kind`, `meta`, `reasons`, `telemetry`
2. Catches `ZodError` and maps each issue to a `schema_failure` reason (cher-style)
3. Returns union format for unversioned requests (includes legacy `error` field)
4. Returns clean format for versioned requests

Validation error example:

```json
{
  "kind": "validation_error",
  "message": "Validation error",
  "reasons": [
    {
      "code": "schema_failure",
      "meta": { "field": "url", "type": "invalid_string", "message": "must be a valid URL" }
    },
    {
      "code": "schema_failure",
      "meta": { "field": "title", "type": "too_small", "message": "title is required" }
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

Unit tests: `pnpm test:unit packages/api`

## File structure

```
src/
  builder.ts          # createService(), ServiceBuilder, VersionBuilder
  versioning.ts       # Forward-copy algorithm + request-time resolution
  middleware.ts       # Built-in tracer + logger (uses @langwatch/telemetry)
  errors.ts           # Error handler (DomainError, ZodError, version-gated format)
  sse.ts              # v.sse() with typed events
  types.ts            # ServiceConfig, EndpointConfig, Handler, BaseApp
  index.ts            # Public re-exports + routeHandlers()
```

## LLM instructions

When creating a new API service using this framework:

1. Create `src/app/api/{name}/[[...route]]/` with two files: `{name}.service.ts` and `route.ts`
2. `route.ts` is always just `export { GET, POST, PUT, DELETE } from "./{name}.service"`
3. Use `createService({ name })` with the service name matching the URL path segment
4. Inject auth, organization, and resource limit middleware from `../../middleware/`
5. Use `.provide()` for service-layer dependencies — factories get `{ project, organization, prisma }`
6. Define Zod schemas for input/output/params next to the service, not in a shared types file
7. Handlers return raw data when `output` is set; the framework validates and serializes
8. Throw `NotFoundError` / `DomainError` for error responses — don't return `c.json({ error }, 404)` manually
9. Use `status: 201` in endpoint config for creation endpoints
10. Copy the scenarios service at `src/app/api/scenarios/[[...route]]/scenarios.service.ts` as a reference
