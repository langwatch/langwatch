import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRestService } from "../builder.js";
import type { InputDeclared, OutputDeclared, RestChain } from "../definition.js";
import type { ServiceContext } from "../types.js";

const VERSION_HEADER = "X-API-Version";

function service() {
  return createRestService({
    name: "thing",
    logger: false,
    tracer: false,
  }).withoutPermission("framework test endpoint");
}

type AssertFalse<T extends false> = T;
type MissingInputCompiles = ReturnType<typeof service>["get"] extends (
  path: "/items",
  version: string,
  handler: (context: ServiceContext, input: { id: string }) => Promise<{ id: string }>,
  define: (builder: RestChain) => RestChain & OutputDeclared,
) => unknown
  ? true
  : false;
type MissingOutputCompiles = ReturnType<typeof service>["get"] extends (
  path: "/items",
  version: string,
  handler: (context: ServiceContext, input: { id: string }) => Promise<{ id: string }>,
  define: (builder: RestChain) => RestChain & InputDeclared,
) => unknown
  ? true
  : false;

export type MissingInputIsRejected = AssertFalse<MissingInputCompiles>;
export type MissingOutputIsRejected = AssertFalse<MissingOutputCompiles>;
export type RestChainHasNoQuerySource = AssertFalse<
  "withQuery" extends keyof RestChain ? true : false
>;
export type RestChainHasNoParamsSource = AssertFalse<
  "withParams" extends keyof RestChain ? true : false
>;

describe("public REST input", () => {
  it("takes GET input from query and merges path parameters", async () => {
    const app = service()
      .get(
        "/items/:id",
        "2026-08-07",
        async (_context, input: { id: string; include: boolean }) => input,
        (builder) =>
          builder
            .withInput(
              z.object({
                id: z.string().startsWith("item_"),
                include: z.enum(["true", "false"]).transform((value) => value === "true"),
              }),
            )
            .withOutput(z.object({ id: z.string(), include: z.boolean() })),
      )
      .build();

    const response = await app.request("/api/v1/thing/items/item_1?include=true&id=ignored");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "item_1", include: true });
  });

  it("validates the complete input once", async () => {
    let validations = 0;
    const input = z.object({ id: z.string(), include: z.string() }).superRefine(() => {
      validations++;
    });
    const app = service()
      .get(
        "/items/:id",
        "2026-08-07",
        async (_context, value: z.output<typeof input>) => value,
        (builder) =>
          builder.withInput(input).withOutput(
            z.object({
              id: z.string(),
              include: z.string(),
            }),
          ),
      )
      .build();

    const response = await app.request("/api/v1/thing/items/item_1?include=yes");

    expect(response.status).toBe(200);
    expect(validations).toBe(1);
  });

  it.each(["post", "put", "patch", "delete"] as const)(
    "takes %s input from one JSON body and merges path parameters",
    async (method) => {
      const builder = service();
      const register = builder[method].bind(builder);
      register(
        "/items/:id",
        "2026-08-07",
        async (_context, input: { id: string; name: string }) => input,
        (definition) =>
          definition
            .withInput(z.object({ id: z.string(), name: z.string().trim().min(1) }))
            .withOutput(z.object({ id: z.string(), name: z.string() })),
      );
      const app = builder.build();

      const response = await app.request("/api/v1/thing/items/path-id", {
        method: method.toUpperCase(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "body-id", name: "  widget  " }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "path-id",
        name: "widget",
      });
    },
  );

  it("rejects malformed input before the handler", async () => {
    let called = false;
    const app = service()
      .post(
        "/items",
        "2026-08-07",
        async (_context, input: { name: string }) => {
          called = true;
          return input;
        },
        (builder) =>
          builder
            .withInput(z.object({ name: z.string().min(1) }))
            .withOutput(z.object({ name: z.string() })),
      )
      .build();

    const response = await app.request("/api/v1/thing/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(422);
    expect(called).toBe(false);
  });

  it("rejects a response that does not satisfy withOutput", async () => {
    const app = service()
      .get(
        "/items",
        "2026-08-07",
        async () => ({ id: 42 }),
        (builder) => builder.withOutput(z.object({ id: z.string() })),
      )
      .build();

    const response = await app.request("/api/v1/thing/items");

    expect(response.status).toBe(500);
  });

  it("does not let a Response bypass withOutput", async () => {
    const app = service()
      .get(
        "/response",
        "2026-08-07",
        async () => Response.json({ id: "unvalidated" }),
        (builder) => builder.withOutput(z.object({ id: z.string() })),
      )
      .build();

    const response = await app.request("/api/v1/thing/response");

    expect(response.status).toBe(500);
  });

  it("serves and documents z.void as a bodyless 204", async () => {
    const app = service()
      .delete(
        "/items/:id",
        "2026-08-07",
        async () => void 0,
        (builder) =>
          builder
            .withInput(z.object({ id: z.string() }))
            .withOutput(z.void())
            .withDocs({ operationId: "deleteThing" }),
      )
      .build();

    const response = await app.request("/api/v1/thing/items/item_1", {
      method: "DELETE",
    });
    const spec = await generateSpecs(app, { excludeStaticFile: false });
    const operation = spec.paths["/api/v1/thing/items/{id}"]?.delete;

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(operation?.responses).toHaveProperty("204");
    expect(operation?.responses?.["204"]).not.toHaveProperty("content");
  });
});

describe("public REST version axes", () => {
  function versionedApp() {
    return service()
      .get(
        "/items/:id",
        "2026-01-15",
        async (_context, input: { id: string }) => ({ id: input.id, value: "old" }),
        (builder) =>
          builder
            .withInput(z.object({ id: z.string() }))
            .withOutput(z.object({ id: z.string(), value: z.literal("old") }))
            .withDocs({ operationId: "getThing" }),
      )
      .get(
        "/items/:id",
        "2026-08-07",
        async (_context, input: { id: string }) => ({ id: input.id, value: "new" }),
        (builder) =>
          builder
            .withInput(z.object({ id: z.string() }))
            .withOutput(z.object({ id: z.string(), value: z.literal("new") }))
            .withDocs({ operationId: "getThing" }),
      )
      .build();
  }

  it("defaults an omitted date version to latest", async () => {
    const app = versionedApp();
    const response = await app.request("/api/v1/thing/items/item_1");
    const explicit = await app.request("/api/v1/thing/latest/items/item_1");

    await expect(response.json()).resolves.toEqual({ id: "item_1", value: "new" });
    await expect(explicit.json()).resolves.toEqual({ id: "item_1", value: "new" });
    expect(response.headers.get(VERSION_HEADER)).toBe("latest");
    expect(response.headers.get("X-API-Version-Status")).toBe("latest");
  });

  it("keeps the global v1 axis static", async () => {
    const response = await versionedApp().request("/api/v2/thing/items/item_1");

    expect(response.status).toBe(404);
  });

  it("selects the same inherited endpoint by URL or header", async () => {
    const app = versionedApp();
    const byUrl = await app.request("/api/v1/thing/2026-04-01/items/item_1");
    const byHeader = await app.request("/api/v1/thing/items/item_1", {
      headers: { [VERSION_HEADER]: "2026-04-01" },
    });

    expect(byUrl.status).toBe(200);
    expect(byHeader.status).toBe(200);
    expect(new Uint8Array(await byUrl.arrayBuffer())).toEqual(
      new Uint8Array(await byHeader.arrayBuffer()),
    );
    expect(byUrl.headers.get(VERSION_HEADER)).toBe("2026-04-01");
    expect(byHeader.headers.get(VERSION_HEADER)).toBe("2026-04-01");
  });

  it("accepts a matching URL and header version", async () => {
    const response = await versionedApp().request("/api/v1/thing/2026-01-15/items/item_1", {
      headers: { [VERSION_HEADER]: "2026-01-15" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ value: "old" });
  });

  it("rejects conflicting URL and header versions", async () => {
    const response = await versionedApp().request("/api/v1/thing/2026-01-15/items/item_1", {
      headers: { [VERSION_HEADER]: "latest" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "api_version_conflict",
    });
  });

  it("rejects an invalid header and does not serve a date before the service existed", async () => {
    const app = versionedApp();
    const invalid = await app.request("/api/v1/thing/items/item_1", {
      headers: { [VERSION_HEADER]: "tomorrow" },
    });
    const tooOld = await app.request("/api/v1/thing/items/item_1", {
      headers: { [VERSION_HEADER]: "2020-01-01" },
    });

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "invalid_api_version",
    });
    expect(tooOld.status).toBe(404);
  });

  it("documents the global v1, explicit dates, latest and the optional header mount", async () => {
    const spec = await generateSpecs(versionedApp(), { excludeStaticFile: false });

    const optional = spec.paths["/api/v1/thing/items/{id}"]?.get;
    expect(optional?.operationId).toBe("getThing");
    expect(optional?.parameters).toContainEqual(
      expect.objectContaining({ in: "header", name: VERSION_HEADER }),
    );
    expect(optional?.parameters).toContainEqual(
      expect.objectContaining({ in: "path", name: "id" }),
    );
    expect(spec.paths["/api/v1/thing/2026-01-15/items/{id}"]?.get?.operationId).toBe(
      "getThing_2026_01_15",
    );
    expect(spec.paths["/api/v1/thing/latest/items/{id}"]?.get?.operationId).toBe("getThing_latest");
  });

  it("applies dated withdrawal through URL and header negotiation", async () => {
    const app = service()
      .get(
        "/retired",
        "2026-01-15",
        async () => ({ value: "kept" }),
        (builder) => builder.withOutput(z.object({ value: z.string() })),
      )
      .withdraw("/retired", "2026-08-07")
      .build();

    const old = await app.request("/api/v1/thing/2026-01-15/retired");
    const removed = await app.request("/api/v1/thing/retired");
    const removedByHeader = await app.request("/api/v1/thing/retired", {
      headers: { [VERSION_HEADER]: "2026-08-07" },
    });

    expect(old.status).toBe(200);
    expect(removed.status).toBe(410);
    expect(removedByHeader.status).toBe(410);
  });
});

describe("public REST registration", () => {
  it("requires path fields in the one input schema", () => {
    expect(() =>
      service().get(
        "/items/:id",
        "2026-08-07",
        async () => ({ ok: true }),
        (builder) =>
          builder
            .withInput(z.object({ another: z.string() }))
            .withOutput(z.object({ ok: z.boolean() })),
      ),
    ).toThrow(/path parameters missing from withInput: id/);
  });

  it("does not add the public REST mounts to createService consumers", async () => {
    const { createService } = await import("../builder.js");
    const app = createService({
      name: "thing",
      basePath: "/api/thing",
      logger: false,
      tracer: false,
    })
      .withoutPermission("framework test endpoint")
      .register(
        "things.get",
        "2026-08-07",
        async () => ({ ok: true }),
        (builder) => builder.withOutput(z.object({ ok: z.boolean() })),
      )
      .build();

    expect((await app.request("/api/thing/latest/things.get", { method: "POST" })).status).toBe(
      200,
    );
    expect((await app.request("/api/v1/thing/things.get", { method: "POST" })).status).toBe(404);
  });
});
