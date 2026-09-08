/**
 * What the REST runtime publishes and serves for a declared router: the
 * addresses a route answers at, the version headers each one carries, and the
 * operations the document publishes.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { featureApi } from "@langwatch/runtime-composition";
import type { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createErrorHandler, PayloadTooLargeError } from "../../errors.ts";
import { createRestRuntime, defineRestRouter } from "../runtime.ts";

const SPEC_OPTIONS = { excludeStaticFile: false } as const;
const VERSION = "2026-09-08";
const BODY_CAP_BYTES = 1024;

interface AnnotationApi {
  getById(input: { id: string }): Promise<{ id: string }>;
  remove(input: { id: string }): Promise<void>;
}

const AnnotationApi = featureApi<AnnotationApi>("annotation");

const annotations = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(VERSION)
  .get("/:id", "getAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input }) => app.getById({ id: input.id }))

  .delete("/:id", "deleteAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:manage")
  .withDocs({ summary: "Delete an annotation in the caller’s project" })
  .handle(async ({ app, input }) => app.remove({ id: input.id }))
  .build();

const application: AnnotationApi = {
  getById: async ({ id }) => ({ id }),
  remove: async () => {},
};

/** The runtime's mount: the process authenticates, the declaration is inert. */
function runtimeApp(app: () => AnnotationApi = () => application): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
    },
  });

  return runtime.mount(annotations.router(), {
    app,
    credential: "projectKey",
    onError: (error) => {
      throw error;
    },
  });
}

function addresses(app: Hono): string[] {
  return [...new Set(app.routes.map((route) => `${route.method} ${route.path}`))].sort();
}

// A family shaped like the secret one: a collection at the family root, a
// sibling by-id route, and a write carrying a declared cap and a tag.
interface SecretApi {
  list(input: { projectId: string }): Promise<{ id: string }[]>;
  getById(input: { id: string }): Promise<{ id: string }>;
  create(input: { name: string }): Promise<{ id: string }>;
}

const SecretApi = featureApi<SecretApi>("secret");

const secrets = defineRestRouter(SecretApi)
  .withNamespace("secrets")
  .withVersion(VERSION)
  .get("/", "listSecrets")
  .withPermission("secrets:view")
  .withOutput(z.object({ id: z.string() }).array())
  .withDocs({ summary: "List project secrets", tags: ["Secrets"] })
  .handle(async ({ app, scope }) => app.list({ projectId: scope.id }))

  .get("/:id", "getSecret")
  .withParams(z.object({ id: z.string() }))
  .withPermission("secrets:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.getById({ id: input.id }))

  .post("/", "createSecret")
  .withInput(z.object({ name: z.string() }))
  .withPermission("secrets:manage")
  .withOutput(z.object({ id: z.string() }))
  .withBodyLimit({ maxBytes: BODY_CAP_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .handle(async ({ app, input }) => app.create({ name: input.name }))
  .build();

const secretApplication: SecretApi = {
  list: async () => [{ id: "the-collection" }],
  getById: async ({ id }) => ({ id }),
  create: async ({ name }) => ({ id: name.slice(0, 4) }),
};

/** The same mount, with the boundary that serialises a handled refusal. */
function secretsApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
    },
  });

  return runtime.mount(secrets.router(), {
    app: () => secretApplication,
    credential: "projectKey",
    onError: createErrorHandler(),
  });
}

async function post(app: Hono, path: string, name: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("a declared REST router mounted through the runtime", () => {
  describe("given the document is generated from the mounted app", () => {
    /** @scenario "The declarations publish the OpenAPI document" */
    it("publishes one operation per mount, uniquely identified, without resolving the app", async () => {
      const refuse = vi.fn(() => {
        throw new Error("OpenAPI generation must not resolve the application");
      });

      const published = await generateSpecs(runtimeApp(refuse), SPEC_OPTIONS);

      expect(refuse).not.toHaveBeenCalled();

      const operationIds = Object.values(published.paths ?? {}).flatMap((item) =>
        Object.values(item as Record<string, { operationId?: string }>).map(
          (operation) => operation.operationId,
        ),
      );

      expect(operationIds).toContain("getAnnotation");
      expect(operationIds).toContain(`getAnnotation_${VERSION.replaceAll("-", "_")}`);
      expect(operationIds).toContain("getAnnotation_latest");
      // Every published operation is uniquely identified, which OpenAPI requires.
      expect(new Set(operationIds).size).toBe(operationIds.length);

      const dated = published.paths?.[`/api/annotations/${VERSION}/{id}`] as
        | { get?: { summary?: string } }
        | undefined;

      expect(dated?.get?.summary).toBe("Get an annotation in the caller’s project");
    });
  });

  describe("given a caller invokes a declared route", () => {
    /** @scenario "A REST endpoint is one complete declaration in the server" */
    it("serves a route declared without output as 204 with an empty body", async () => {
      const response = await runtimeApp().request(`/api/annotations/${VERSION}/annotation-1`, {
        method: "DELETE",
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });

    /** @scenario "A declared route answers at every address its family already served" */
    it("answers at the dated path, the bare path and the /api/v1 twin alike", async () => {
      for (const path of [
        `/api/annotations/${VERSION}/annotation-1`,
        "/api/annotations/annotation-1",
        "/api/annotations/latest/annotation-1",
        "/api/v1/annotations/annotation-1",
        `/api/v1/annotations/${VERSION}/annotation-1`,
        "/api/v1/annotations/latest/annotation-1",
      ]) {
        const response = await runtimeApp().request(path);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: "annotation-1" });
      }
    });

    /** @scenario "A declared route answers at every address its family already served" */
    it("registers every address it answers at, and nothing outside its own family", () => {
      const registered = addresses(runtimeApp());

      expect(registered).toContain(`GET /api/annotations/${VERSION}/:id`);
      expect(registered).toContain("GET /api/annotations/:id");
      expect(registered).toContain("DELETE /api/v1/annotations/latest/:id");
      expect(
        registered.every((address) => / \/api\/(v1\/)?annotations/.test(address)),
      ).toBe(true);
    });

    /** @scenario "A declared route answers at every address its family already served" */
    it("names the version it answered, and its status", async () => {
      const dated = await runtimeApp().request(`/api/annotations/${VERSION}/annotation-1`);
      expect(dated.headers.get("X-API-Version")).toBe(VERSION);
      expect(dated.headers.get("X-API-Version-Status")).toBe("stable");

      const bare = await runtimeApp().request("/api/annotations/annotation-1");
      expect(bare.headers.get("X-API-Version")).toBe("latest");
      expect(bare.headers.get("X-API-Version-Status")).toBe("latest");
    });

    /** @scenario "A declared route answers at every address its family already served" */
    it("serves a real date it never registered from the registration before it", async () => {
      const response = await runtimeApp().request("/api/annotations/2027-01-01/annotation-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("X-API-Version")).toBe("2027-01-01");
      await expect(response.json()).resolves.toEqual({ id: "annotation-1" });
    });

    /** @scenario "A declared route answers at every address its family already served" */
    it("refuses a version segment that names no servable version", async () => {
      const response = await runtimeApp().request("/api/annotations/2020-01-01/annotation-1");

      expect(response.status).toBe(404);
    });
  });
});

describe("a declared route that caps the body it accepts", () => {
  describe("given the route also declares a body schema", () => {
    /** @scenario "A declared body cap is measured before the body is parsed" */
    it("serves a body under the cap", async () => {
      const response = await post(secretsApp(), `/api/secrets/${VERSION}`, "n".repeat(512));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "nnnn" });
    });

    /** @scenario "A declared body cap is measured before the body is parsed" */
    it("refuses a body over the cap as the declared refusal, never as a server fault", async () => {
      const response = await post(secretsApp(), `/api/secrets/${VERSION}`, "n".repeat(2048));

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ code: "payload_too_large" });
    });
  });
});

describe("a declared collection route", () => {
  /** @scenario "A collection route is addressed at the family root, with no trailing slash" */
  it("answers at its dated, latest and bare addresses, none of them trailing a slash", () => {
    const registered = addresses(secretsApp());

    expect(registered).toContain(`GET /api/secrets/${VERSION}`);
    expect(registered).toContain("GET /api/secrets/latest");
    expect(registered).toContain("GET /api/secrets");
    expect(registered).toContain(`GET /api/v1/secrets/${VERSION}`);
    expect(registered.filter((address) => address.endsWith("/"))).toEqual([]);
  });

  /** @scenario "A collection route is addressed at the family root, with no trailing slash" */
  it("reaches the collection handler, not the by-id one, at every address", async () => {
    for (const path of [
      `/api/secrets/${VERSION}`,
      "/api/secrets/latest",
      "/api/secrets",
      `/api/v1/secrets/${VERSION}`,
      "/api/v1/secrets/latest",
      "/api/v1/secrets",
    ]) {
      const response = await secretsApp().request(path);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([{ id: "the-collection" }]);
    }
  });
});

describe("the document a declared route publishes", () => {
  /** @scenario "A route's declared tags reach the published document" */
  it("files the operation under the tags the declaration named", async () => {
    const published = await generateSpecs(secretsApp(), SPEC_OPTIONS);
    const dated = published.paths?.[`/api/secrets/${VERSION}`] as
      | { get?: { tags?: string[] } }
      | undefined;

    expect(dated?.get?.tags).toEqual(["Secrets"]);
  });
});
