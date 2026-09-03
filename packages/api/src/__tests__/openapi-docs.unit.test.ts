import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";

// ---------------------------------------------------------------------------
// Documentation contract: the published spec contains exactly the bare alias
// path of each documented endpoint. Dated / latest / preview mounts keep
// validating and answering with version headers, but never reach the spec.
// ---------------------------------------------------------------------------

function buildDocumentedApp() {
  return createService({ name: "things", basePath: "/api/things" })
    .version("2025-03-15", (v) => {
      v.get(
        "/",
        { noPermission: { reason: "framework test endpoint" },
          output: z.array(z.object({ id: z.string() })),
          description: "Lists every thing in the project.",
          docs: {
            summary: "List things",
            tags: ["Things"],
            operationId: "listThings",
            security: [{ bearerAuth: [] }],
            responses: { "404": { description: "Thing not found" } },
          },
        },
        async () => [],
      );
      v.post(
        "/",
        { noPermission: { reason: "framework test endpoint" },
          input: z.object({ name: z.string().min(1) }),
          output: z.object({ id: z.string() }),
          status: 201,
          docs: { operationId: "createThing" },
        },
        async () => ({ id: "thing_1" }),
      );
      v.get(
        "/hidden",
        { noPermission: { reason: "framework test endpoint" }, output: z.object({ ok: z.boolean() }), docs: { hide: true } },
        async () => ({ ok: true }),
      );
      v.post(
        "/undocumented",
        { noPermission: { reason: "framework test endpoint" }, input: z.object({ value: z.number() }) },
        async (c) => c.json({ accepted: true }),
      );
      // No `input` schema: the body is documented through docs.requestBody.
      v.post(
        "/frames",
        {
          noPermission: { reason: "framework test endpoint" },
          description: "Takes frames the handler parses itself.",
          docs: {
            operationId: "postFrames",
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { frames: { type: "array", items: { type: "object" } } } },
                },
              },
            },
          },
        },
        async (c) => c.json({ accepted: 1 }),
      );
      // Registered after the static paths: overlapping routes stack in
      // registration order, so the param route must not shadow them.
      v.get(
        "/:id",
        { noPermission: { reason: "framework test endpoint" },
          params: z.object({ id: z.string() }),
          query: z.object({ verbose: z.enum(["true", "false"]) }),
          output: z.object({ id: z.string() }),
          docs: { operationId: "getThing" },
        },
        async (_c, { params }) => ({ id: params.id }),
      );
    })
    .preview((v) => {
      v.get("/beta", { noPermission: { reason: "framework test endpoint" }, output: z.object({ beta: z.boolean() }) }, async () => ({
        beta: true,
      }));
    })
    .build();
}

describe("OpenAPI documentation", () => {
  describe("when generating the spec for a documented service", () => {
    it("publishes only bare alias path keys", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      const keys = Object.keys(spec.paths ?? {});
      expect(keys.sort()).toEqual([
        "/api/things",
        "/api/things/frames",
        "/api/things/{id}",
      ]);
      for (const key of keys) {
        expect(key).not.toMatch(/\/(latest|preview|20\d{2}-\d{2}-\d{2})(\/|$)/);
      }
    });

    it("lands docs summary, tags, operationId, security, and responses in the document", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      const list = spec.paths["/api/things"]?.get;
      expect(list?.summary).toBe("List things");
      expect(list?.tags).toEqual(["Things"]);
      expect(list?.operationId).toBe("listThings");
      expect(list?.security).toEqual([{ bearerAuth: [] }]);
      expect(list?.description).toBe("Lists every thing in the project.");
      expect(list?.responses).toHaveProperty("200");
      expect(list?.responses?.["404"]).toMatchObject({
        description: "Thing not found",
      });

      const create = spec.paths["/api/things"]?.post;
      expect(create?.operationId).toBe("createThing");
      expect(create?.responses).toHaveProperty("201");
    });

    it("keeps the documented mount's parameters and request body in the document", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      const parameters = spec.paths["/api/things/{id}"]?.get?.parameters ?? [];
      expect(parameters).toContainEqual(
        expect.objectContaining({ in: "path", name: "id" }),
      );
      expect(parameters).toContainEqual(
        expect.objectContaining({ in: "query", name: "verbose" }),
      );
      expect(spec.paths["/api/things"]?.post?.requestBody).toBeDefined();
    });

    it("documents the request body an endpoint declares through docs.requestBody", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      const frames = spec.paths["/api/things/frames"]?.post;
      expect(frames?.operationId).toBe("postFrames");
      expect(frames?.requestBody).toEqual({
        content: {
          "application/json": {
            schema: { type: "object", properties: { frames: { type: "array", items: { type: "object" } } } },
          },
        },
      });
    });

    it("removes docs.hide endpoints from the document while still serving them", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      expect(spec.paths["/api/things/hidden"]).toBeUndefined();

      const res = await app.request("/api/things/hidden");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("keeps endpoints without output, description, or docs out of the document", async () => {
      const app = buildDocumentedApp();
      const spec = await generateSpecs(app);

      expect(spec.paths["/api/things/undocumented"]).toBeUndefined();

      const res = await app.request("/api/things/undocumented", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "not-a-number" }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe("when an endpoint is withdrawn", () => {
    it("keeps the withdrawn endpoint out of the document while answering 410", async () => {
      const app = createService({ name: "w", basePath: "/api/w" })
        .version("2025-01-01", (v) => {
          v.get(
            "/old",
            { noPermission: { reason: "framework test endpoint" },
              output: z.object({ ok: z.boolean() }),
              docs: { operationId: "getOld" },
            },
            async () => ({ ok: true }),
          );
        })
        .version("2025-06-01", (v) => {
          v.withdraw("get", "/old");
        })
        .build();

      const spec = await generateSpecs(app);
      expect(Object.keys(spec.paths ?? {})).toEqual([]);

      const res = await app.request("/api/w/old");
      expect(res.status).toBe(410);
    });
  });

  describe("when requests hit undocumented mounts", () => {
    it("still enforces input validation on dated and latest mounts", async () => {
      const app = buildDocumentedApp();

      for (const [path, version] of [
        ["/api/things/2025-03-15/", "2025-03-15"],
        ["/api/things/latest/", "latest"],
        ["/api/things", null],
      ] as const) {
        const res = await app.request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "" }),
        });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("validation_error");
        if (version) expect(res.headers.get("X-API-Version")).toBe(version);
      }
    });

    it("still enforces query validation on dated and latest mounts", async () => {
      const app = buildDocumentedApp();

      for (const path of [
        "/api/things/2025-03-15/thing_1?verbose=nope",
        "/api/things/latest/thing_1?verbose=nope",
      ]) {
        const res = await app.request(path);
        expect(res.status).toBe(422);
      }

      const ok = await app.request(
        "/api/things/2025-03-15/thing_1?verbose=true",
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ id: "thing_1" });
    });
  });
});
