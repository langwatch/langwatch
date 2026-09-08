/**
 * What the REST runtime publishes and serves for a declared router: the
 * addresses a route answers at, the version headers each one carries, and the
 * operations the document publishes.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { createLogger } from "@langwatch/observability";
import { featureApi } from "@langwatch/runtime-composition";
import type { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { anyAuthenticated, publicRoute, securityRequirement } from "../../access/access.ts";
import { createErrorHandler, PayloadTooLargeError } from "../../errors.ts";
import { documentedResponses, securityForCredentialClass } from "../openapi.ts";
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

// ─────────────────────────────────────────────────────────────────────────────
// A family answering behind the organization door.
// ─────────────────────────────────────────────────────────────────────────────

interface RoleApi {
  listRoles(input: { organizationId: string }): Promise<{ id: string }[]>;
  createRole(input: { organizationId: string; name: string }): Promise<{ id: string }>;
}

const RoleApi = featureApi<RoleApi>("role");
const roleRestFacts = defineRestMiddleware("roleRestFacts", z.object({ organizationId: z.string() }));

const ORGANIZATION_ID = "organization-1";

const roles = defineRestRouter(RoleApi)
  .withNamespace("roles")
  .withVersion(VERSION)
  .withCredential("organizationKey")

  .get("/", "listRoles")
  .withPermission("organization:manage")
  // The literal is the type proof: a handler whose scope were the project tier
  // could not answer it, so this route would not compile on a project door.
  .withOutput(
    z.object({
      tier: z.literal("organization"),
      scopeId: z.string(),
      factOrganizationId: z.string(),
      roles: z.array(z.string()),
    }),
  )
  .withDocs({ summary: "List the organization's roles", tags: ["Roles"] })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, scope }, organization) => ({
    tier: scope.tier,
    scopeId: scope.id,
    factOrganizationId: organization.organizationId,
    roles: (await app.listRoles({ organizationId: scope.id })).map((role) => role.id),
  }))

  .post("/", "createRole")
  .withInput(z.object({ organizationId: z.string(), name: z.string() }))
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input, scope }) =>
    app.createRole({ organizationId: scope.id, name: input.name }),
  )

  .get("/health", "readRolesHealth")
  .withAccess(publicRoute({ reason: "liveness probe; reads no organization data" }))
  .withOutput(z.object({ ok: z.literal(true) }))
  .handle(({ actor, scope }) => ({ ok: actor === null && scope === null }) as { ok: true })

  .get("/legacy", "listLegacyRoles")
  .withPermission("organization:manage")
  .withOutput(z.array(z.string()))
  .withDeprecated({ successor: "/api/roles", notice: "Use /api/roles instead" })
  .handle(async ({ app, scope }) =>
    (await app.listRoles({ organizationId: scope.id })).map((role) => role.id),
  )
  .build();

const roleApplication: RoleApi = {
  listRoles: async ({ organizationId }) => [{ id: `role-in-${organizationId}` }],
  createRole: async ({ name }) => ({ id: name }),
};

/** The organization door: the process resolved a key, not a project. */
function rolesApp(
  scope: { tier: "organization" | "project"; id: string } = {
    tier: "organization",
    id: ORGANIZATION_ID,
  },
): { app: Hono; authenticate: ReturnType<typeof vi.fn> } {
  const authenticate = vi.fn(() => ({ actor: null, scope }));

  const runtime = createRestRuntime({ identity: { authenticate } });

  const app = runtime.mount(roles.router(), {
    app: () => roleApplication,
    onError: createErrorHandler(),
    facts: [bindRestMiddleware(roleRestFacts, () => ({ organizationId: ORGANIZATION_ID }))],
  });

  return { app, authenticate };
}

describe("a family whose declaration names the organization door", () => {
  describe("given a caller the door resolved an organization for", () => {
    /** @scenario "A handler on an organization door receives the organization scope" */
    it("hands the handler the organization scope, and the fact the mount bound", async () => {
      const response = await rolesApp().app.request(`/api/roles/${VERSION}`);

      expect(response.status).toBe(200);

      await expect(response.json()).resolves.toEqual({
        tier: "organization",
        scopeId: ORGANIZATION_ID,
        factOrganizationId: ORGANIZATION_ID,
        roles: [`role-in-${ORGANIZATION_ID}`],
      });
    });

    /** @scenario "An organization id the credential did not resolve is a handled refusal" */
    it("serves a body naming the organization the credential resolved", async () => {
      const response = await rolesApp().app.request(`/api/roles/${VERSION}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: ORGANIZATION_ID, name: "release-manager" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "release-manager" });
    });

    /** @scenario "An organization id the credential did not resolve is a handled refusal" */
    it("refuses a body naming another organization, naming the field and neither id", async () => {
      const response = await rolesApp().app.request(`/api/roles/${VERSION}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "organization-2", name: "release-manager" }),
      });

      expect(response.status).toBe(403);
      const body = (await response.json()) as { code: string; meta?: Record<string, unknown> };

      expect(body.code).toBe("scope_input_mismatch");
      expect(body.meta).toMatchObject({ field: "organizationId" });
      expect(JSON.stringify(body)).not.toContain(ORGANIZATION_ID);
    });
  });

  describe("given the process's door resolved a project instead", () => {
    /** @scenario "A door that resolves the wrong tier is a wiring failure, not an answer" */
    it("refuses rather than handing a project scope to an organization handler", async () => {
      const { app } = rolesApp({ tier: "project", id: "project-1" });

      const response = await app.request(`/api/roles/${VERSION}`);

      expect(response.status).toBe(500);
    });
  });

  describe("given the document and the route registry", () => {
    /** @scenario "An organization route publishes the organization security scheme" */
    it("records the organization credential class, which publishes the admin key scheme", () => {
      rolesApp();

      const route = getRoutePolicy("get", `/api/roles/${VERSION}`);

      expect(route).toMatchObject({
        credentialClass: "organization_api_key",
        policy: { credential: "apiKey", permissions: ["organization:manage"] },
      });

      expect(
        securityForCredentialClass({
          operationKey: `GET /api/roles/${VERSION}`,
          credentialClass: route!.credentialClass,
        }),
      ).toEqual([{ admin_api_key: [] }]);

      expect(securityRequirement("organizationKey")).toEqual([{ admin_api_key: [] }]);
    });
  });

  describe("given the routes an organization family declares beside its scoped ones", () => {
    /** @scenario "A route that answers without a credential resolves none" */
    it("answers a public route without resolving the organization credential", async () => {
      const { app, authenticate } = rolesApp();

      const response = await app.request("/api/roles/health");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(authenticate).not.toHaveBeenCalled();
    });

    /** @scenario "Deprecation reaches the document and the wire" */
    it("carries the deprecation headers of a superseded organization route", async () => {
      const response = await rolesApp().app.request("/api/roles/legacy");

      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("X-API-Deprecation-Notice")).toBe("Use /api/roles instead");
    });
  });
});

// A v1-only organization family: the generation is its whole contract.
const codingAgent = defineRestRouter(RoleApi)
  .withNamespace("coding-agent")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("organizationKey")
  .get("/usage", "readCodingAgentUsage")
  .withPermission("organization:manage")
  .withOutput(z.object({ organizationId: z.string() }))
  .handle(({ scope }) => ({ organizationId: scope.id }))
  .build();

describe("a v1-only family on the organization door", () => {
  function codingAgentApp(): Hono {
    const runtime = createRestRuntime({
      identity: {
        authenticate: () => ({
          actor: null,
          scope: { tier: "organization", id: ORGANIZATION_ID } as const,
        }),
      },
    });

    return runtime.mount(codingAgent.router(), {
      app: () => roleApplication,
      onError: createErrorHandler(),
    });
  }

  /** @scenario "A v1-only family answers nowhere else" */
  it("answers at its /api/v1 path with the organization scope, and nowhere else", async () => {
    const app = codingAgentApp();

    const answered = await app.request("/api/v1/coding-agent/usage");

    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({ organizationId: ORGANIZATION_ID });
    expect((await app.request("/api/coding-agent/usage")).status).toBe(404);
  });

  /** @scenario "An organization route publishes the organization security scheme" */
  it("registers the organization credential class at its one address", () => {
    codingAgentApp();

    expect(getRoutePolicy("get", "/api/v1/coding-agent/usage")).toMatchObject({
      credentialClass: "organization_api_key",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A family shaped like `/api/projects`: an organization key at the door, a
// listing the key's own ceiling answers, a by-id route checked at the project
// its path names, and no `/api/v1` twin the family ever served.
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectApi {
  visible(input: { organizationId: string }): Promise<{ id: string }[]>;
  read(input: { projectId: string }): Promise<{ id: string }>;
}

const ProjectApi = featureApi<ProjectApi>("project");
const PROJECT_ID = "project-7";

const LISTING_IS_THE_GATE =
  "the listing answers exactly the projects this key already holds, so authentication is the whole gate";

const projects = defineRestRouter(ProjectApi)
  .withNamespace("projects")
  .withVersion(VERSION)
  .withAddressing("dated", { v1Twin: false })
  .withCredential("organizationKey")

  .get("/", "listProjects")
  .withAccess(anyAuthenticated({ reason: LISTING_IS_THE_GATE }))
  .withOutput(z.array(z.string()))
  .withDocs({ summary: "List the projects this credential reaches" })
  .handle(async ({ app, scope }) =>
    (await app.visible({ organizationId: scope.id })).map((project) => project.id),
  )

  .get("/:projectId", "getProject")
  .withParams(z.object({ projectId: z.string() }))
  .withPermission("project:view", { at: "route", param: "projectId" })
  .withOutput(
    z.object({ id: z.string(), scopeId: z.string(), targetTier: z.string(), targetId: z.string() }),
  )
  .handle(async ({ app, input, scope, target }) => ({
    id: (await app.read({ projectId: input.projectId })).id,
    scopeId: scope.id,
    targetTier: target?.tier ?? "none",
    targetId: target?.id ?? "none",
  }))
  .build();

const projectApplication: ProjectApi = {
  visible: async ({ organizationId }) => [{ id: `project-in-${organizationId}` }],
  read: async ({ projectId }) => ({ id: projectId }),
};

function projectsApp(permitted = true): {
  app: Hono;
  identify: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
  authorize: ReturnType<typeof vi.fn>;
} {
  const scope = { tier: "organization", id: ORGANIZATION_ID } as const;
  const identify = vi.fn(() => ({ actor: null, scope }));
  const authenticate = vi.fn(() => ({
    actor: { type: "api_key", id: "key-1" } as const,
    scope,
  }));
  const authorize = vi.fn(() => ({ permitted, organizationRole: null }));

  const runtime = createRestRuntime({ identity: { authenticate, identify, authorize } });

  const app = runtime.mount(projects.router(), {
    app: () => projectApplication,
    onError: createErrorHandler(),
  });

  return { app, identify, authenticate, authorize };
}

describe("a route the family's own door alone gates", () => {
  /** @scenario "A route the family's own door alone gates asks no permission of it" */
  it("resolves the credential and its scope, and asks no permission of it", async () => {
    const { app, identify, authenticate } = projectsApp();

    const response = await app.request(`/api/projects/${VERSION}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([`project-in-${ORGANIZATION_ID}`]);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  /** @scenario "A route the family's own door alone gates asks no permission of it" */
  it("records the family's credential class and the reason the route gave", () => {
    projectsApp();

    expect(getRoutePolicy("get", `/api/projects/${VERSION}`)).toMatchObject({
      credentialClass: "organization_api_key",
      policy: { kind: "handlerManaged", reason: LISTING_IS_THE_GATE, permissions: [] },
    });
  });

  /** @scenario "A route the family's own door alone gates asks no permission of it" */
  it("keeps the family's security scheme, unlike a public route", async () => {
    const published = await generateSpecs(projectsApp().app, SPEC_OPTIONS);
    const item = published.paths?.["/api/projects"] as { get?: { security?: unknown[] } } | undefined;

    expect(item?.get?.security).toBeUndefined();
  });
});

describe("a route whose permission is checked at the scope its path names", () => {
  /** @scenario "A route checks its permission at the scope its own path names" */
  it("asks about the project the path named, and hands the handler both scopes", async () => {
    const { app, authorize } = projectsApp();

    const response = await app.request(`/api/projects/${VERSION}/${PROJECT_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: PROJECT_ID,
      scopeId: ORGANIZATION_ID,
      targetTier: "project",
      targetId: PROJECT_ID,
    });

    expect(authorize).toHaveBeenCalledWith({
      caller: expect.objectContaining({ scope: { tier: "organization", id: ORGANIZATION_ID } }),
      permission: "project:view",
      target: { tier: "project", id: PROJECT_ID },
    });
  });

  /** @scenario "A route checks its permission at the scope its own path names" */
  it("denies a caller the process refused at that scope", async () => {
    const response = await projectsApp(false).app.request(`/api/projects/${PROJECT_ID}`);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
  });
});

describe("a dated family that declares no /api/v1 twin", () => {
  /** @scenario "A family whose paths were never aliased declares no twin" */
  it("answers at its dated, latest and bare paths, and at no /api/v1 address", async () => {
    const { app } = projectsApp();

    for (const path of [
      `/api/projects/${VERSION}/${PROJECT_ID}`,
      `/api/projects/latest/${PROJECT_ID}`,
      `/api/projects/${PROJECT_ID}`,
    ]) {
      expect((await app.request(path)).status).toBe(200);
    }

    expect((await app.request(`/api/v1/projects/${PROJECT_ID}`)).status).toBe(404);
    expect(addresses(app).some((address) => address.includes("/api/v1/"))).toBe(false);
    expect(getRoutePolicy("get", `/api/projects/${VERSION}`)?.canonicalPath).toBeUndefined();
  });

  /** @scenario "A family whose paths were never aliased declares no twin" */
  it("publishes exactly the addresses it serves, and no twin among them", async () => {
    const published = await generateSpecs(projectsApp().app, SPEC_OPTIONS);

    expect(Object.keys(published.paths ?? {}).sort()).toEqual([
      "/api/projects",
      `/api/projects/${VERSION}`,
      `/api/projects/${VERSION}/{projectId}`,
      "/api/projects/latest",
      "/api/projects/latest/{projectId}",
      "/api/projects/{projectId}",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A family shaped like `/api/webhooks/v1`: the generation is a segment of the
// namespace's own path rather than a prefix in front of it.
// ─────────────────────────────────────────────────────────────────────────────

const webhooks = defineRestRouter(ProjectApi)
  .withNamespace("webhooks")
  .withVersion(VERSION)
  .withAddressing("v1-in-path")
  .get("/endpoints/:projectId", "listWebhookEndpoints")
  .withParams(z.object({ projectId: z.string() }))
  .withPermission("webhookEndpoints:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.read({ projectId: input.projectId }))
  .build();

function webhooksApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: PROJECT_ID } }),
    },
  });

  return runtime.mount(webhooks.router(), {
    app: () => projectApplication,
    onError: createErrorHandler(),
  });
}

describe("a family that names its generation inside its own path", () => {
  /** @scenario "A family serves one static generation instead of dated namespaces" */
  it("answers once, at that path, with no dated namespace or latest alias beside it", async () => {
    const app = webhooksApp();

    const answered = await app.request(`/api/webhooks/v1/endpoints/${PROJECT_ID}`);

    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({ id: PROJECT_ID });

    expect(addresses(app).filter((address) => address.startsWith("GET "))).toEqual([
      "GET /api/webhooks/v1/endpoints/:projectId",
    ]);

    for (const path of [
      `/api/webhooks/endpoints/${PROJECT_ID}`,
      `/api/webhooks/${VERSION}/endpoints/${PROJECT_ID}`,
      `/api/webhooks/v1/latest/endpoints/${PROJECT_ID}`,
      `/api/v1/webhooks/endpoints/${PROJECT_ID}`,
    ]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  /** @scenario "A family serves one static generation instead of dated namespaces" */
  it("publishes exactly the address it serves", async () => {
    const published = await generateSpecs(webhooksApp(), SPEC_OPTIONS);

    expect(Object.keys(published.paths ?? {})).toEqual([
      "/api/webhooks/v1/endpoints/{projectId}",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A family shaped like `/api/v1/platform-health`: a deployment's own secret at
// the door, and a report that is an answer at 503 as much as at 200.
// ─────────────────────────────────────────────────────────────────────────────

interface PlatformHealthApi {
  check(): Promise<{ status: "healthy" | "unhealthy" }>;
}

const PlatformHealthApi = featureApi<PlatformHealthApi>("platform-health");
const healthReport = z.object({ status: z.enum(["healthy", "unhealthy"]) });

const MONITORED =
  "the deployment's own monitoring key is compared by the door; a monitor is not a tenant, so there is no permission to ask of it";

const platformHealth = defineRestRouter(PlatformHealthApi)
  .withNamespace("platform-health")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("internalSecret")
  .get("/", "getPlatformHealth")
  .withAccess(anyAuthenticated({ reason: MONITORED }))
  .responds({ 200: healthReport, 503: healthReport })
  .withDocs({ summary: "Report whether the platform is working" })
  .handle(async ({ app, actor, scope }) => {
    const report = await app.check();

    // The literals are the proof the door named no tenant: a handler on a
    // scoped door could not answer these.
    expect(actor).toBeNull();
    expect(scope).toBeNull();

    return report.status === "healthy"
      ? ({ status: 200, body: report } as const)
      : ({ status: 503, body: report } as const);
  })
  .build();

function platformHealthApp(
  options: { status?: "healthy" | "unhealthy"; tenanted?: boolean } = {},
): { app: Hono; identify: ReturnType<typeof vi.fn> } {
  // The door compares this deployment's monitoring key and names it; it
  // resolves no tenant, and no permission is asked of what it resolved.
  const identify = vi.fn(() =>
    options.tenanted
      ? { actor: null, scope: { tier: "organization", id: ORGANIZATION_ID } as const }
      : {
          actor: { type: "api_key", id: "monitor" } as const,
          scope: null,
          internal: { type: "internalSecret", secretName: "PLATFORM_HEALTH_API_KEY" } as const,
        },
  );

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("A platform-health route asks no permission of its credential.");
      },
      identify,
    },
  });

  const app = runtime.mount(platformHealth.router(), {
    app: () => ({ check: async () => ({ status: options.status ?? "healthy" }) }),
    onError: createErrorHandler(),
  });

  return { app, identify };
}

describe("a family behind a deployment's own secret", () => {
  /** @scenario "A family behind a deployment secret names no tenant" */
  it("hands the handler no actor and no scope once the door accepted the secret", async () => {
    const { app, identify } = platformHealthApp();

    const response = await app.request("/api/v1/platform-health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "healthy" });
    expect(identify).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A family behind a deployment secret names no tenant" */
  it("records the internal-secret credential class rather than a public route", () => {
    platformHealthApp();

    const route = getRoutePolicy("get", "/api/v1/platform-health");

    expect(route).toMatchObject({ credentialClass: "internal_secret" });
    expect(route?.policy.kind).not.toBe("public");
  });

  /** @scenario "A family behind a deployment secret publishes the secret's own scheme" */
  it("publishes the scheme its holder presents, not an empty requirement", () => {
    expect(
      securityForCredentialClass({
        operationKey: "GET /api/v1/platform-health",
        credentialClass: "internal_secret",
      }),
    ).toEqual([{ internal_secret: [] }]);

    expect(securityRequirement("internalSecret")).toEqual([{ internal_secret: [] }]);
  });

  /** @scenario "A family behind a deployment secret names no tenant" */
  it("fails rather than answering when the door resolved a tenant scope for it", async () => {
    const response = await platformHealthApp({ tenanted: true }).app.request(
      "/api/v1/platform-health",
    );

    expect(response.status).toBe(500);
  });
});

describe("a route that declares the several answers it may give", () => {
  /** @scenario "An endpoint declares the several answers it may give" */
  it("answers a declared non-success with the body that status names", async () => {
    const response = await platformHealthApp({ status: "unhealthy" }).app.request(
      "/api/v1/platform-health",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unhealthy" });
  });

  /** @scenario "An endpoint declares the several answers it may give" */
  it("lists every declared status in the published document", async () => {
    const published = await generateSpecs(platformHealthApp().app, SPEC_OPTIONS);
    const item = published.paths?.["/api/v1/platform-health"] as
      | { get?: { responses?: Record<string, { description?: string }> } }
      | undefined;

    expect(Object.keys(item?.get?.responses ?? {}).sort()).toEqual(["200", "503"]);
    expect(item?.get?.responses?.["503"]?.description).toBe("Service Unavailable");
  });

  /** @scenario "An endpoint declares the several answers it may give" */
  it("records the request as handled rather than as a server fault", async () => {
    // The family's request logger, by the name the runtime builds it under and
    // the factory caches it by: this IS the instance the middleware writes to.
    const logger = createLogger("langwatch:api:platform-health");
    const info = vi.spyOn(logger, "info");
    const error = vi.spyOn(logger, "error");

    try {
      await platformHealthApp({ status: "unhealthy" }).app.request("/api/v1/platform-health");

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503 }),
        "request handled",
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });

  /** @scenario "An endpoint that declares several answers may not also declare one" */
  it("fails rather than serving a status the declaration never named", async () => {
    const runtime = createRestRuntime({
      identity: {
        authenticate: () => ({
          actor: null,
          scope: null,
          internal: { type: "internalSecret", secretName: "PLATFORM_HEALTH_API_KEY" } as const,
        }),
      },
    });

    // The other door on the same credential: this one IS asked a permission,
    // so the runtime resolves it through `authenticate` rather than `identify`.
    const undeclared = defineRestRouter(PlatformHealthApi)
      .withNamespace("platform-health-undeclared")
      .withVersion(VERSION)
      .withAddressing("v1-only")
      .withCredential("internalSecret")
      .get("/", "getUndeclaredPlatformHealth")
      .withPermission("activityMonitor:view")
      .responds({ 200: healthReport, 503: healthReport })
      .handle(() => ({ status: 200, body: { status: "healthy" } }) as never)
      .build();

    const app = runtime.mount(undeclared.router(), {
      app: () => ({ check: async () => ({ status: "healthy" }) as const }),
      onError: createErrorHandler(),
    });

    // The handler is typed to the map, so answering off-contract takes a cast;
    // what is pinned here is what the runtime does when one gets through.
    Reflect.set(undeclared.router().routes[0]!, "handler", () => ({
      status: 418,
      body: { status: "healthy" },
    }));

    expect((await app.request("/api/v1/platform-health-undeclared")).status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A family behind one directory connection's own SCIM token.
// ─────────────────────────────────────────────────────────────────────────────

const scimUsers = defineRestRouter(RoleApi)
  .withNamespace("scim")
  .withVersion(VERSION)
  .withAddressing("v1-in-path")
  .withCredential("scimToken")
  .get("/Users", "listScimUsers")
  .withPermission("organization:manage")
  .withOutput(z.object({ tier: z.literal("organization"), organizationId: z.string() }))
  .handle(({ scope }) => ({ tier: scope.tier, organizationId: scope.id }))
  .build();

function scimApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: null,
        scope: { tier: "organization", id: ORGANIZATION_ID } as const,
      }),
    },
  });

  return runtime.mount(scimUsers.router(), {
    app: () => roleApplication,
    onError: createErrorHandler(),
  });
}

describe("a family behind one directory connection's SCIM token", () => {
  /** @scenario "A declaration may name the SCIM token as its door" */
  it("hands the handler the organization the token resolved", async () => {
    const response = await scimApp().request("/api/scim/v1/Users");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tier: "organization",
      organizationId: ORGANIZATION_ID,
    });
  });

  /** @scenario "A declaration may name the SCIM token as its door" */
  it("records the SCIM credential class, which publishes the SCIM bearer scheme", () => {
    scimApp();

    const route = getRoutePolicy("get", "/api/scim/v1/Users");

    expect(route).toMatchObject({ credentialClass: "scim_token" });
    expect(
      securityForCredentialClass({
        operationKey: "GET /api/scim/v1/Users",
        credentialClass: route!.credentialClass,
      }),
    ).toEqual([{ scim_bearer: [] }]);

    expect(securityRequirement("scimToken")).toEqual([{ scim_bearer: [] }]);
  });
});
