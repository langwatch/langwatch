import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";

// ---------------------------------------------------------------------------
// Documentation contract (ADR 002 §2): the published spec carries EVERY dated
// version of every documented endpoint, plus latest — so a pinned client sees
// the schemas its version actually serves. Preview is never documented, and no
// documented path lacks a version namespace.
// ---------------------------------------------------------------------------

const SPEC_OPTIONS = { excludeStaticFile: false } as const;

function buildDocumentedApp() {
  return (
    createService({ name: "things", basePath: "/api/things" })
      .registerRoute(
        "get",
        "/",
        "2025-03-15",
        async () => [] as { id: string }[],
        (b) =>
          b.withOutput(z.array(z.object({ id: z.string() }))).withDocs({
            summary: "List things",
            description: "Lists every thing in the project.",
            tags: ["Things"],
            operationId: "listThings",
            security: [{ bearerAuth: [] }],
            responses: { "404": { description: "Thing not found" } },
          }),
      )
      .register(
        "things.create",
        "2025-03-15",
        async () => ({ id: "thing_1" }),
        (b) =>
          b
            .withInput(z.object({ name: z.string().min(1) }))
            .withOutput(z.object({ id: z.string() }))
            .withDocs({ operationId: "createThing" }),
      )
      // A later override: the document carries both dated versions, each with
      // the schemas that version serves.
      .register(
        "things.create",
        "2025-06-01",
        async () => ({ id: "thing_2", kind: "v2" }),
        (b) =>
          b
            .withInput(z.object({ name: z.string().min(1) }))
            .withOutput(z.object({ id: z.string(), kind: z.string() }))
            .withDocs({ operationId: "createThing" }),
      )
      .registerRoute(
        "get",
        "/hidden",
        "2025-03-15",
        async () => ({ ok: true }),
        (b) => b.withOutput(z.object({ ok: z.boolean() })).withDocs({ hide: true }),
      )
      .registerRoute(
        "get",
        "/:id",
        "2025-03-15",
        async (_c, input: { id: string }) => ({ id: input.id }),
        (b) =>
          b
            .withParams(z.object({ id: z.string() }))
            .withQuery(z.object({ verbose: z.enum(["true", "false"]) }))
            .withOutput(z.object({ id: z.string() }))
            .withDocs({ operationId: "getThing" }),
      )
      .register(
        "things.beta",
        "preview",
        async () => ({ beta: true }),
        (b) => b.withOutput(z.object({ beta: z.boolean() })),
      )
      .build()
  );
}

describe("OpenAPI documentation", () => {
  it("documents every dated version plus latest, each with the schemas that version serves", async () => {
    const spec = await generateSpecs(buildDocumentedApp(), SPEC_OPTIONS);

    const january = spec.paths["/api/things/2025-03-15/things.create"]?.post;
    const june = spec.paths["/api/things/2025-06-01/things.create"]?.post;
    const latest = spec.paths["/api/things/latest/things.create"]?.post;

    expect(january).toBeDefined();
    expect(june).toBeDefined();
    expect(latest).toBeDefined();

    const successSchema = (operation: unknown) => {
      const content = (
        operation as {
          responses: Record<string, { content: Record<string, { schema: unknown }> }>;
        }
      ).responses["200"]!.content["application/json"]!.schema;
      return JSON.stringify(content);
    };
    // The January mount documents the January schema; June and latest the override's.
    expect(successSchema(january)).not.toEqual(successSchema(june));
    expect(successSchema(june)).toEqual(successSchema(latest));
  });

  it("never documents preview, and no documented path lacks a version namespace", async () => {
    const spec = await generateSpecs(buildDocumentedApp(), SPEC_OPTIONS);

    const keys = Object.keys(spec.paths ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain("/preview/");
      expect(key).toMatch(/\/api\/things\/(latest|20\d{2}-\d{2}-\d{2})(\/|$)/);
    }
  });

  it("lands summary, description, tags, operationId, security and responses in the document", async () => {
    const spec = await generateSpecs(buildDocumentedApp(), SPEC_OPTIONS);

    const list = spec.paths["/api/things/2025-03-15/"]?.get;
    expect(list?.summary).toBe("List things");
    expect(list?.description).toBe("Lists every thing in the project.");
    expect(list?.tags).toEqual(["Things"]);
    expect(list?.operationId).toBe("listThings_2025_03_15");
    expect(list?.security).toEqual([{ bearerAuth: [] }]);
    expect(list?.responses).toHaveProperty("200");
    expect(list?.responses?.["404"]).toMatchObject({
      description: "Thing not found",
    });
  });

  it("gives every documented mount a unique operationId", async () => {
    const spec = await generateSpecs(buildDocumentedApp(), SPEC_OPTIONS);
    const operationIds = Object.values(spec.paths).flatMap((path) =>
      Object.values(path ?? {}).flatMap((operation) => {
        if (
          typeof operation !== "object" ||
          operation === null ||
          !("operationId" in operation) ||
          typeof operation.operationId !== "string"
        ) {
          return [];
        }
        return [operation.operationId];
      }),
    );

    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(spec.paths["/api/things/latest/things.create"]?.post?.operationId).toBe("createThing");
    expect(spec.paths["/api/things/2025-06-01/things.create"]?.post?.operationId).toBe(
      "createThing_2025_06_01",
    );
  });

  it("keeps the documented mounts' parameters and request body in the document", async () => {
    const spec = await generateSpecs(buildDocumentedApp(), SPEC_OPTIONS);

    const parameters = spec.paths["/api/things/2025-03-15/{id}"]?.get?.parameters ?? [];
    expect(parameters).toContainEqual(expect.objectContaining({ in: "path", name: "id" }));
    expect(parameters).toContainEqual(expect.objectContaining({ in: "query", name: "verbose" }));
    expect(spec.paths["/api/things/2025-03-15/things.create"]?.post?.requestBody).toBeDefined();
  });

  it("removes docs.hide endpoints from the document while still serving them", async () => {
    const app = buildDocumentedApp();
    const spec = await generateSpecs(app, SPEC_OPTIONS);

    expect(Object.keys(spec.paths ?? {}).filter((p) => p.includes("hidden"))).toEqual([]);

    const res = await app.request("/api/things/2025-03-15/hidden");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("keeps endpoints that declare nothing documentable out of the document", async () => {
    const app = createService({ name: "w", basePath: "/api/w" })
      .register("things.undocumented", "2025-03-15", async (c) => c.json({ accepted: true }))
      .build();
    const spec = await generateSpecs(app, SPEC_OPTIONS);

    expect(Object.keys(spec.paths ?? {})).toEqual([]);

    const res = await app.request("/api/w/2025-03-15/things.undocumented", {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  it("marks a deprecated operation on every dated mount, with the notice in its description", async () => {
    const app = createService({ name: "w", basePath: "/api/w" })
      .register(
        "things.old",
        "2025-01-15",
        async () => "x",
        (b) =>
          b
            .withOutput(z.string())
            .withDocs({ operationId: "oldThing", description: "The old way." })
            .withDeprecated("use things.new after 2026-01-01"),
      )
      .register(
        "things.old",
        "2025-06-01",
        async () => "x",
        (b) =>
          b
            .withOutput(z.string())
            .withDocs({ operationId: "oldThing" })
            .withDeprecated("use things.new after 2026-01-01"),
      )
      .build();
    const spec = await generateSpecs(app, SPEC_OPTIONS);

    for (const path of [
      "/api/w/2025-01-15/things.old",
      "/api/w/2025-06-01/things.old",
      "/api/w/latest/things.old",
    ]) {
      const operation = spec.paths[path]?.post;
      expect(operation?.deprecated).toBe(true);
      expect(operation?.description).toContain("use things.new after 2026-01-01");
    }
    // The notice rides alongside the declared description, not instead of it.
    expect(spec.paths["/api/w/2025-01-15/things.old"]?.post?.description).toContain("The old way.");
  });

  describe("when an endpoint is withdrawn", () => {
    it("leaves the document at the version it was withdrawn from while answering 410", async () => {
      const app = createService({ name: "w", basePath: "/api/w" })
        .registerRoute(
          "get",
          "/old",
          "2025-01-01",
          async () => ({ ok: true }),
          (b) => b.withOutput(z.object({ ok: z.boolean() })).withDocs({ operationId: "getOld" }),
        )
        .withdrawRoute("get", "/old", "2025-06-01")
        .build();

      const spec = await generateSpecs(app, SPEC_OPTIONS);
      const keys = Object.keys(spec.paths ?? {});
      // Still documented where it still answers; gone from the withdrawal
      // version onward — including latest, which is the withdrawal version.
      expect(keys).toEqual(["/api/w/2025-01-01/old"]);

      const res = await app.request("/api/w/2025-06-01/old");
      expect(res.status).toBe(410);
    });
  });

  describe("when requests hit any mount", () => {
    it("enforces input validation on dated and latest mounts alike", async () => {
      const app = buildDocumentedApp();

      for (const [path, version] of [
        ["/api/things/2025-03-15/things.create", "2025-03-15"],
        ["/api/things/latest/things.create", "latest"],
        ["/api/things/2025-04-01/things.create", "2025-04-01"],
      ] as const) {
        const res = await app.request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "" }),
        });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("validation_error");
        expect(res.headers.get("X-API-Version")).toBe(version);
      }
    });

    it("enforces query validation on dated and latest mounts", async () => {
      const app = buildDocumentedApp();

      for (const path of [
        "/api/things/2025-03-15/thing_1?verbose=nope",
        "/api/things/latest/thing_1?verbose=nope",
      ]) {
        const res = await app.request(path);
        expect(res.status).toBe(422);
      }

      const ok = await app.request("/api/things/2025-03-15/thing_1?verbose=true");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ id: "thing_1" });
    });
  });
});
