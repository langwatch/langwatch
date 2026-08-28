import { generateSpecs } from "hono-openapi";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRestService, createService } from "../builder.js";
import type { RestEndpoint, RestEndpointHandler } from "../definition.js";
import type { RestService } from "../builder.js";
import { serializeEndpointResult } from "../response.js";

type AssertFalse<T extends false> = T;
type IsAssignable<TFrom, TTo> = TFrom extends TTo ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;
type AssertTrue<T extends true> = T;

const typedInput = z.object({ id: z.string() });
const typedOutput = z.string();
type TypedHandler = RestEndpointHandler<unknown, typeof typedInput, typeof typedOutput>;
type WrongInputIsRejected = AssertFalse<
  IsAssignable<(context: never, input: { id: number }) => string, TypedHandler>
>;
type WrongOutputIsRejected = AssertFalse<
  IsAssignable<(context: never, input: { id: string }) => number, TypedHandler>
>;
type ResponseOutputIsRejected = AssertFalse<
  IsAssignable<(context: never, input: { id: string }) => Response, TypedHandler>
>;
type MissingRestInputCannotHandle = AssertTrue<IsNever<ThisParameterType<RestEndpoint["handle"]>>>;
type RestFacadeHasNoBareRegistration = AssertFalse<
  "register" extends keyof RestService ? true : false
>;
type RestFacadeHasNoProviderRegistration = AssertFalse<
  "provide" extends keyof RestService ? true : false
>;

function service() {
  return createRestService({
    name: "thing",
    logger: false,
    maxInputBytes: 1_024,
    tracer: false,
  })
    .withoutPermission("framework test endpoint")
    .withoutRateLimit("framework test endpoint")
    .withoutResourceLimit("framework test endpoint");
}

describe("modern REST", () => {
  it("defaults to /api/v1/{name} and permits a validated explicit base path", async () => {
    const endpoint = (path: string) =>
      createRestService({
        name: "thing",
        basePath: path,
        logger: false,
        maxInputBytes: 1_024,
        tracer: false,
      })
        .withoutPermission("framework test endpoint")
        .withoutRateLimit("framework test endpoint")
        .withoutResourceLimit("framework test endpoint")
        .get("/items", "2026-08-07", (definition) =>
          definition
            .withInput(z.object({}))
            .withOutput(z.object({ ok: z.boolean() }))
            .handle(async () => ({ ok: true })),
        )
        .build();

    const defaultApp = service()
      .get("/items", "2026-08-07", (definition) =>
        definition
          .withInput(z.object({}))
          .withOutput(z.object({ ok: z.boolean() }))
          .handle(async () => ({ ok: true })),
      )
      .build();
    const aliasApp = endpoint("/api/thing");

    expect((await defaultApp.request("/api/v1/thing/items")).status).toBe(200);
    expect((await aliasApp.request("/api/thing/items")).status).toBe(200);
    expect((await aliasApp.request("/api/v1/thing/items")).status).toBe(404);
  });

  it("rejects unsafe REST base paths", () => {
    expect(() =>
      createRestService({
        name: "thing",
        basePath: "api/thing",
        logger: false,
        maxInputBytes: 1_024,
      }),
    ).toThrow(/basePath must be an absolute/);
    expect(() =>
      createRestService({
        name: "thing",
        basePath: "/api/thing/:id",
        logger: false,
        maxInputBytes: 1_024,
      }),
    ).toThrow(/static lower-kebab segments/);
  });

  it("captures schemas before deriving the handler input and output", async () => {
    const app = service()
      .get("/items/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string(), reveal: z.enum(["true", "false"]) }))
          .withOutput(z.object({ id: z.string(), reveal: z.boolean() }))
          .handle(async (_context, input) => ({
            id: input.id,
            reveal: input.reveal === "true",
          })),
      )
      .build();

    const response = await app.request("/api/v1/thing/items/item_1?reveal=true");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "item_1", reveal: true });
  });

  it("validates one merged request, output, and the JSON body limit", async () => {
    let calls = 0;
    const app = service()
      .post("/items/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string(), name: z.string().min(1) }))
          .withOutput(z.object({ id: z.string(), name: z.string() }))
          .handle(async (_context, input) => {
            calls++;
            return input;
          }),
      )
      .build();

    const invalid = await app.request("/api/v1/thing/items/item_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const nonObject = await app.request("/api/v1/thing/items/item_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["not an object"]),
    });
    const oversized = await app.request("/api/v1/thing/items/item_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(2_000) }),
    });
    const valid = await app.request("/api/v1/thing/items/item_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "widget" }),
    });

    expect([invalid.status, nonObject.status, oversized.status]).toEqual([422, 422, 422]);
    expect(valid.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("keeps repeated GET query values, merges path fields, and parses once", async () => {
    let parses = 0;
    const input = z
      .object({ id: z.string(), tag: z.array(z.string()) })
      .superRefine(() => void parses++);
    const app = service()
      .get("/items/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(input)
          .withOutput(z.object({ id: z.string(), tag: z.array(z.string()) }))
          .handle(async (_context, value) => value),
      )
      .build();

    const response = await app.request("/api/v1/thing/items/item_1?tag=error&tag=llm");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "item_1", tag: ["error", "llm"] });
    expect(parses).toBe(1);
  });

  it.each(["post", "put", "patch", "delete"] as const)(
    "uses one JSON body for %s",
    async (method) => {
      const register = (rest: ReturnType<typeof service>) => {
        type Definition = Parameters<typeof rest.post>[2];
        const definition: Definition = (endpoint) =>
          endpoint
            .withInput(z.object({ id: z.string(), name: z.string().trim() }))
            .withOutput(z.object({ id: z.string(), name: z.string() }))
            .handle(async (_context, input) => input);
        if (method === "post") return rest.post("/items/:id", "2026-08-07", definition);
        if (method === "put") return rest.put("/items/:id", "2026-08-07", definition);
        if (method === "patch") return rest.patch("/items/:id", "2026-08-07", definition);
        return rest.delete("/items/:id", "2026-08-07", definition);
      };
      const app = register(service()).build();
      const response = await app.request("/api/v1/thing/items/path-id", {
        method: method.toUpperCase(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "body-id", name: " widget " }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "path-id", name: "widget" });
    },
  );

  it("rejects invalid output and raw Response bypasses", async () => {
    const app = service()
      .get("/wrong", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({}))
          .withOutput(z.object({ id: z.string().refine((value) => value.startsWith("ok")) }))
          .handle(async () => ({ id: "wrong" })),
      )
      .build();

    expect((await app.request("/api/v1/thing/wrong")).status).toBe(500);

    let responseError: unknown;
    const serializer = new Hono().get("/response", (context) => {
      try {
        serializeEndpointResult({
          c: context,
          config: { output: z.object({ id: z.string() }) },
          kind: "public-rest",
          result: Response.json({ id: "unvalidated" }),
        });
      } catch (error) {
        responseError = error;
      }
      return context.body(null);
    });
    await serializer.request("/response");

    expect(responseError).toBeInstanceOf(TypeError);
  });

  it("serves and documents z.void as bodyless 204", async () => {
    const app = service()
      .delete("/items/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.void())
          .withDocs({ operationId: "deleteThing" })
          .handle(async () => void 0),
      )
      .build();
    const response = await app.request("/api/v1/thing/items/item_1", { method: "DELETE" });
    const spec = await generateSpecs(app, { excludeStaticFile: false });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(spec.paths["/api/v1/thing/items/{id}"]?.delete?.responses?.["204"]).not.toHaveProperty(
      "content",
    );
  });

  it("documents the static v1 path and negotiated version paths", async () => {
    const app = service()
      .get("/items/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ id: z.string() }))
          .withDocs({ operationId: "getThing" })
          .handle(async (_context, input) => input),
      )
      .build();

    const spec = await generateSpecs(app, { excludeStaticFile: false });

    expect(spec.paths["/api/v1/thing/items/{id}"]?.get?.operationId).toBe("getThing");
    expect(spec.paths["/api/v1/thing/latest/items/{id}"]?.get?.operationId).toBe("getThing_latest");
  });

  it("negotiates dated, inherited, latest and header versions without conflicts", async () => {
    const app = service()
      .get("/versioned/:id", "2026-01-15", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ value: z.literal("old") }))
          .handle(async () => ({ value: "old" })),
      )
      .get("/versioned/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ value: z.literal("new") }))
          .handle(async () => ({ value: "new" })),
      )
      .build();
    const inherited = await app.request("/api/v1/thing/2026-04-01/versioned/item_1");
    const latest = await app.request("/api/v1/thing/versioned/item_1");
    const byHeader = await app.request("/api/v1/thing/versioned/item_1", {
      headers: { "X-API-Version": "2026-04-01" },
    });
    const conflict = await app.request("/api/v1/thing/2026-01-15/versioned/item_1", {
      headers: { "X-API-Version": "latest" },
    });
    const invalid = await app.request("/api/v1/thing/versioned/item_1", {
      headers: { "X-API-Version": "tomorrow" },
    });
    const tooOld = await app.request("/api/v1/thing/versioned/item_1", {
      headers: { "X-API-Version": "2020-01-01" },
    });

    await expect(inherited.json()).resolves.toEqual({ value: "old" });
    await expect(latest.json()).resolves.toEqual({ value: "new" });
    await expect(byHeader.json()).resolves.toEqual({ value: "old" });
    expect([conflict.status, invalid.status, tooOld.status]).toEqual([400, 400, 404]);
  });

  it("rejects blank REST limit and permission opt-outs", () => {
    const definition = (
      endpoint: Parameters<Parameters<ReturnType<typeof service>["get"]>[2]>[0],
    ) =>
      endpoint
        .withInput(z.object({}))
        .withOutput(z.object({ ok: z.boolean() }))
        .handle(async () => ({ ok: true }));

    expect(() =>
      service().withoutPermission(" ").get("/blank-permission", "2026-08-07", definition).build(),
    ).toThrow(/blank reason/);
    expect(() =>
      service().withoutRateLimit(" ").get("/blank-rate", "2026-08-07", definition),
    ).toThrow(/rate limit/);
    expect(() =>
      service().withoutResourceLimit(" ").get("/blank-resource", "2026-08-07", definition),
    ).toThrow(/resource limit/);
  });

  it("rejects empty authenticated OpenAPI security declarations", () => {
    const auth = async (
      _context: Parameters<NonNullable<Parameters<typeof createRestService>[0]["auth"]>>[0],
      next: () => Promise<void>,
    ) => next();
    expect(() =>
      createRestService({
        name: "auth",
        auth,
        logger: false,
        maxInputBytes: 1_024,
        openapiSecurity: [],
      }),
    ).toThrow(/security scheme/);
    expect(() =>
      createRestService({
        name: "auth",
        auth,
        logger: false,
        maxInputBytes: 1_024,
        openapiSecurity: [{}],
      }),
    ).toThrow(/security scheme/);
  });

  it("derives authenticated OpenAPI security from the service", async () => {
    const app = createRestService({
      name: "documented-auth",
      logger: false,
      maxInputBytes: 1_024,
      tracer: false,
      auth: async (_context, next) => next(),
      openapiSecurity: [{ bearerAuth: [] }],
    })
      .withoutPermission("documentation probe")
      .withoutRateLimit("documentation probe")
      .withoutResourceLimit("documentation probe")
      .get("/thing/:id", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ id: z.string() }))
          .withOutput(z.object({ id: z.string() }))
          .withDocs({ operationId: "getAuthenticatedThing" })
          .handle(async (_context, input) => input),
      )
      .build();
    const spec = await generateSpecs(app, { excludeStaticFile: false });
    const operation = spec.paths["/api/v1/documented-auth/thing/{id}"]?.get;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses).toHaveProperty("200");
  });

  it("rejects a validated project target before permissions, limits, and the handler", async () => {
    let permissionCalls = 0;
    let limitCalls = 0;
    let handlerCalls = 0;
    const app = createRestService({
      name: "project",
      logger: false,
      maxInputBytes: 1_024,
      projectIdInput: true,
      rateLimiter: {
        check: async () => {
          limitCalls++;
          return { allowed: true };
        },
      },
      permissionEnforcer: () => async (_context, next) => {
        permissionCalls++;
        await next();
      },
      tracer: false,
      auth: async (context, next) => {
        context.set("project", { id: "project_a" });
        await next();
      },
      openapiSecurity: [{ bearerAuth: [] }],
    })
      .withPermission("project:view")
      .withRateLimit()
      .withoutResourceLimit("no resource ceiling for this probe")
      .get("/target", "2026-08-07", (endpoint) =>
        endpoint
          .withInput(z.object({ projectId: z.string() }))
          .withOutput(z.object({ ok: z.boolean() }))
          .handle(async () => {
            handlerCalls++;
            return { ok: true };
          }),
      )
      .build();
    const response = await app.request("/api/v1/project/target?projectId=project_b");

    expect(response.status).toBe(403);
    expect([permissionCalls, limitCalls, handlerCalls]).toEqual([0, 0, 0]);
  });

  it("keeps a versioned createService family off the public REST mount", async () => {
    const app = createService({
      name: "thing",
      basePath: "/api/thing",
      logger: false,
      tracer: false,
    })
      .withoutPermission("framework test endpoint")
      .registerRoute(
        "post",
        "/things.get",
        "2026-08-07",
        async () => ({ ok: true }),
        (definition) => definition.withOutput(z.object({ ok: z.boolean() })),
      )
      .build();

    expect((await app.request("/api/thing/latest/things.get", { method: "POST" })).status).toBe(
      200,
    );
    expect((await app.request("/api/v1/thing/things.get", { method: "POST" })).status).toBe(404);
  });
});
