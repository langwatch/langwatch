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

import { publicRoute } from "../../access/access.ts";
import { createErrorHandler, PayloadTooLargeError } from "../../errors.ts";
import { documentedResponses } from "../openapi.ts";
import { bindRestHeader, bindRestMiddleware, defineRestMiddleware } from "../request.ts";
import {
  createRestRuntime,
  defineRestRouter,
  getRoutePolicy,
  projectRestFacts,
  type RestDeprecationLogPort,
} from "../runtime.ts";

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

// ─────────────────────────────────────────────────────────────────────────────
// The facts a mount binds, and what the handler is handed beside its input.
// ─────────────────────────────────────────────────────────────────────────────

interface ReportApi {
  read(input: { id: string }): Promise<{ id: string }>;
}

const ReportApi = featureApi<ReportApi>("ops");
const surface = defineRestMiddleware("surface", z.string().nullable());

const reports = defineRestRouter(ReportApi)
  .withNamespace("reports")
  .withVersion(VERSION)
  .get("/:id", "getReport")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string(), platformUrl: z.string(), surface: z.string() }))
  .withMiddleware(projectRestFacts, surface)
  .handle(async ({ app, input }, project, header) => {
    const report = await app.read({ id: input.id });

    return {
      id: report.id,
      platformUrl: `https://app.langwatch.test/${project.projectSlug}/reports/${report.id}`,
      surface: header ?? "api",
    };
  })
  .build();

function reportsApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
    },
  });

  return runtime.mount(reports.router(), {
    app: () => ({ read: async ({ id }: { id: string }) => ({ id }) }),
    credential: "projectKey",
    onError: createErrorHandler(),
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "acme",
        viewerUserId: null,
        actorId: "user-1",
      })),
      bindRestHeader(surface, "x-langwatch-surface"),
    ],
  });
}

describe("a route whose declaration names the facts it needs", () => {
  describe("given the mount bound each of them once", () => {
    /** @scenario "A route's declared facts are bound once at the mount and reach every handler" */
    it("hands the handler each parsed fact, in declaration order, beside its input", async () => {
      const response = await reportsApp().request(`/api/reports/${VERSION}/report-1`, {
        headers: { "x-langwatch-surface": "cli" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "report-1",
        platformUrl: "https://app.langwatch.test/acme/reports/report-1",
        surface: "cli",
      });
    });

    /** @scenario "A route's declared facts are bound once at the mount and reach every handler" */
    it("resolves the facts at every address the route answers at", async () => {
      for (const path of [
        "/api/reports/report-1",
        "/api/reports/latest/report-1",
        "/api/v1/reports/report-1",
        "/api/reports/2027-01-01/report-1",
      ]) {
        const response = await reportsApp().request(path);

        await expect(response.json()).resolves.toMatchObject({ surface: "api" });
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A family whose published generation is its whole contract.
// ─────────────────────────────────────────────────────────────────────────────

const runPlans = defineRestRouter(ReportApi)
  .withNamespace("run-plans")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .get("/:id", "getRunPlan")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.read({ id: input.id }))
  .build();

function runPlansApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
    },
  });

  return runtime.mount(runPlans.router(), {
    app: () => ({ read: async ({ id }: { id: string }) => ({ id }) }),
    credential: "projectKey",
    onError: createErrorHandler(),
  });
}

describe("a family declared v1-only", () => {
  /** @scenario "A family already under /api/v1 is mounted once" */
  it("mounts each route once, at /api/v1, and never doubles the version segment", () => {
    const registered = addresses(runPlansApp());

    expect(registered.filter((address) => address.startsWith("GET "))).toEqual([
      "GET /api/v1/run-plans/:id",
    ]);
    expect(registered.some((address) => address.includes("/v1/v1"))).toBe(false);
  });

  /** @scenario "A v1-only family answers nowhere else" */
  it("answers at its /api/v1 path", async () => {
    const response = await runPlansApp().request("/api/v1/run-plans/plan-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "plan-1" });
  });

  /** @scenario "A v1-only family answers nowhere else" */
  it("answers nowhere else: no bare path, no dated path, no latest, no date fallback", async () => {
    for (const path of [
      "/api/run-plans/plan-1",
      `/api/run-plans/${VERSION}/plan-1`,
      "/api/run-plans/latest/plan-1",
      `/api/v1/run-plans/${VERSION}/plan-1`,
      "/api/v1/run-plans/latest/plan-1",
      "/api/v1/run-plans/2027-01-01/plan-1",
    ]) {
      const response = await runPlansApp().request(path);

      expect(response.status).toBe(404);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A superseded family, and a route that answers with no credential.
// ─────────────────────────────────────────────────────────────────────────────

const notFoundBody = z.object({ error: z.string() });

const legacyReports = defineRestRouter(ReportApi)
  .withNamespace("legacy-reports")
  .withVersion(VERSION)
  .withDeprecated({ successor: "/api/v1/reports", notice: "Use /api/v1/reports instead" })
  .get("/health", "readLegacyHealth")
  .withAccess(publicRoute({ reason: "liveness probe; reads no project data" }))
  .withOutput(z.object({ ok: z.literal(true) }))
  .handle(({ actor, scope }) => ({ ok: actor === null && scope === null }) as { ok: true })

  .get("/:id", "getLegacyReport")
  .withParams(z.object({ id: z.string().min(4) }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .withDocs({
    summary: "Read a report",
    responses: documentedResponses({ 404: notFoundBody }),
  })
  .handle(async ({ app, input }) => app.read({ id: input.id }))
  .build();

/** The mount, plus the door's own spy: a public route must never reach it. */
function legacyReportsApp(deprecationLog?: RestDeprecationLogPort): {
  app: Hono;
  authenticate: ReturnType<typeof vi.fn>;
} {
  const authenticate = vi.fn(() => ({
    actor: null,
    scope: { tier: "project", id: "project-1" } as const,
  }));

  const runtime = createRestRuntime({
    identity: { authenticate },
    ...(deprecationLog ? { deprecationLog } : {}),
  });

  const app = runtime.mount(legacyReports.router(), {
    app: () => ({ read: async ({ id }: { id: string }) => ({ id }) }),
    credential: "projectKey",
    onError: createErrorHandler(),
  });

  return { app, authenticate };
}

describe("a family the declaration marked superseded", () => {
  /** @scenario "Deprecation reaches the document and the wire" */
  it("carries the deprecation headers on a live answer, and reports the first call once", async () => {
    const deprecatedRouteCalled = vi.fn();
    const { app } = legacyReportsApp({ deprecatedRouteCalled });

    const response = await app.request("/api/legacy-reports/report-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Link")).toBe('</api/v1/reports>; rel="successor-version"');
    expect(response.headers.get("X-API-Deprecation-Notice")).toBe("Use /api/v1/reports instead");
    expect(response.headers.get("Warning")).toBe('299 - "Use /api/v1/reports instead"');

    await app.request(`/api/legacy-reports/${VERSION}/report-2`);

    expect(deprecatedRouteCalled).toHaveBeenCalledTimes(1);
    expect(deprecatedRouteCalled).toHaveBeenCalledWith({
      family: "legacy-reports",
      operation: "getLegacyReport",
      successor: "/api/v1/reports",
      notice: "Use /api/v1/reports instead",
    });
  });

  /** @scenario "Deprecation reaches the document and the wire" */
  it("marks every dated mount of the operation deprecated, with the notice", async () => {
    const published = await generateSpecs(legacyReportsApp().app, SPEC_OPTIONS);

    for (const path of [
      "/api/legacy-reports/{id}",
      `/api/legacy-reports/${VERSION}/{id}`,
      "/api/legacy-reports/latest/{id}",
    ]) {
      const item = published.paths?.[path] as
        | { get?: { deprecated?: boolean; description?: string } }
        | undefined;

      expect(item?.get?.deprecated).toBe(true);
      expect(item?.get?.description).toContain("Use /api/v1/reports instead");
    }
  });

  /** @scenario "Deprecation headers ride errors too" */
  it("carries them on a refusal too", async () => {
    const response = await legacyReportsApp().app.request("/api/legacy-reports/no");

    expect(response.status).toBe(422);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("X-API-Deprecation-Notice")).toBe("Use /api/v1/reports instead");
    expect(response.headers.get("Warning")).toBe('299 - "Use /api/v1/reports instead"');
  });

  /** @scenario "A route's declared responses reach the published document" */
  it("publishes the answers the route documented beside its declared success", async () => {
    const published = await generateSpecs(legacyReportsApp().app, SPEC_OPTIONS);
    const item = published.paths?.["/api/legacy-reports/{id}"] as
      | { get?: { responses?: Record<string, { description?: string }> } }
      | undefined;

    expect(Object.keys(item?.get?.responses ?? {}).sort()).toEqual(["200", "404"]);
    expect(item?.get?.responses?.["404"]?.description).toBe("Not Found");
  });
});

describe("a route declared public", () => {
  /** @scenario "A route that answers without a credential resolves none" */
  it("answers without resolving a credential, with a null actor and a null scope", async () => {
    const { app, authenticate } = legacyReportsApp();

    const response = await app.request("/api/legacy-reports/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(authenticate).not.toHaveBeenCalled();
  });

  /** @scenario "A route that answers without a credential resolves none" */
  it("is published with no security requirement, unlike its scoped siblings", async () => {
    const published = await generateSpecs(legacyReportsApp().app, SPEC_OPTIONS);
    const publicItem = published.paths?.["/api/legacy-reports/health"] as
      | { get?: { security?: unknown[] } }
      | undefined;
    const scopedItem = published.paths?.["/api/legacy-reports/{id}"] as
      | { get?: { security?: unknown[] } }
      | undefined;

    expect(publicItem?.get?.security).toEqual([]);
    expect(scopedItem?.get?.security).toBeUndefined();
  });

  /** @scenario "A route that answers without a credential resolves none" */
  it("is registered as a public route, reaching by no credential class", () => {
    legacyReportsApp();

    expect(getRoutePolicy("get", "/api/legacy-reports/health")).toMatchObject({
      credentialClass: "none",
      policy: { kind: "public", reason: "liveness probe; reads no project data" },
    });
  });
});
