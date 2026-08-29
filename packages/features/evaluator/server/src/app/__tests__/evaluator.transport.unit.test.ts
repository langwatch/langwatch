/**
 * @vitest-environment node
 *
 * The `/api/evaluators` door: the five routes it publishes, the permission
 * each declares, the immutability rule it enforces on `config.evaluatorType`,
 * the config merge a partial update performs, and the shape a rejected create
 * body comes back as.
 *
 * Ported from two files under `platform/app/src/app/api/evaluators/__tests__`:
 * `evaluators-api.integration.test.ts`, which drove this family against
 * Postgres, and `create-evaluator-validation.unit.test.ts`, which mounted the
 * create schema on a bare Hono. The schema now lives in this package
 * (`transport/api-rest/evaluator.schemas.ts`), so it is exercised here through
 * the real family instead.
 *
 * The application is stubbed. This file asserts what the transport does, never
 * what the domain decides.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { AVAILABLE_EVALUATORS, type Evaluator } from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import type { EvaluatorApp } from "../evaluator.app";
import { createEvaluatorsRestApp } from "../../transport/api-rest/evaluator.api";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const evaluator = {
  id: "evaluator_1",
  projectId: "project-1",
  name: "Original Name",
  slug: "original-name",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match", settings: {} },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Evaluator;

/** What the read routes answer with: the row plus its computed fields. */
const enriched = { ...evaluator, fields: [], outputFields: [] };

/**
 * The process's own boundary renderer, reduced to what these tests read back.
 *
 * A handled error keeps its own status and code, and its `meta` is spread onto
 * the body — which is what puts `fields` beside `error` on a rejected request.
 * The real renderer adds remediation tips, a trace block and the log line;
 * none of that is the door's, and none of it is asserted here.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      {
        error: serialized.code,
        message: error.message,
        ...serialized.meta,
        reasons: serialized.reasons,
      },
      serialized.httpStatus as 400,
    );
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/** Every enforcement step the builder chose for the route under test. */
function testSecurity(): { security: AppRestSecurity; chain: string[] } {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: ({ permission }) => record(`authorize:${permission}`),
    authorizeApiKeyCeiling: ({ permission }) => record(`ceiling:${permission}`),
    authenticateOrganization: () => record("authenticateOrganization"),
    authorizeOrganizationPermission: ({ permission }) => record(`authorizeOrg:${permission}`),
    authorizeRouteProjectPermission: ({ permission }) =>
      record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

function buildApi(overrides: Record<string, unknown> = {}) {
  const { security, chain } = testSecurity();
  const stub = {
    getAllWithFields: vi.fn(async () => [enriched]),
    tryGetByIdOrSlugWithFields: vi.fn(async () => enriched),
    getByIdWithFields: vi.fn(async () => enriched),
    tryGetById: vi.fn(async () => evaluator),
    createWithResolvedDefaults: vi.fn(async () => evaluator),
    update: vi.fn(async () => evaluator),
    archive: vi.fn(async () => evaluator),
    ...overrides,
  } as unknown as EvaluatorApp;

  const family = createEvaluatorsRestApp({
    security,
    app: () => stub,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    // Resolving the organization reads the process's team graph, so the
    // middleware that sets it is supplied rather than imported.
    organizationMiddleware: async (c, next) => {
      chain.push("organization");
      c.set("organization", { id: "organization-1" });
      await next();
    },
  });

  return { hono: family.hono, stub, chain };
}

const jsonHeaders = { "content-type": "application/json" };

type MountedFamily = ReturnType<typeof buildApi>["hono"];

const post = (hono: MountedFamily, body: unknown) =>
  hono.request("/api/evaluators", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

describe("createEvaluatorsRestApp", () => {
  describe("given the mounted family", () => {
    it("declares the read permission on both reads", async () => {
      const list = buildApi();
      await list.hono.request("/api/evaluators");
      expect(list.chain).toEqual([
        "authenticateProject",
        "authorize:evaluations:view",
        "organization",
      ]);

      const read = buildApi();
      await read.hono.request("/api/evaluators/evaluator_1");
      expect(read.chain).toEqual([
        "authenticateProject",
        "authorize:evaluations:view",
        "organization",
      ]);
    });

    it("declares create on the create, update on the edit, and manage on the archive", async () => {
      const create = buildApi();
      await post(create.hono, {
        name: "New",
        config: { evaluatorType: "langevals/exact_match" },
      });
      expect(create.chain).toEqual([
        "authenticateProject",
        "authorize:evaluations:create",
        "organization",
      ]);

      const update = buildApi();
      await update.hono.request("/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Updated Name" }),
      });
      expect(update.chain).toEqual([
        "authenticateProject",
        "authorize:evaluations:update",
        "organization",
      ]);

      const archive = buildApi();
      await archive.hono.request("/api/evaluators/evaluator_1", { method: "DELETE" });
      expect(archive.chain).toEqual([
        "authenticateProject",
        "authorize:evaluations:manage",
        "organization",
      ]);
    });

    it("resolves the organization only after the caller is authenticated", async () => {
      const { hono, chain } = buildApi();

      await hono.request("/api/evaluators");

      expect(chain.indexOf("organization")).toBeGreaterThan(chain.indexOf("authenticateProject"));
    });
  });

  describe("when one evaluator is read", () => {
    it("asks for it by whichever identifier the caller sent", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/evaluators/original-name");

      expect(response.status).toBe(200);
      expect(stub.tryGetByIdOrSlugWithFields).toHaveBeenCalledWith({
        idOrSlug: "original-name",
        projectId: "project-1",
      });
      await expect(response.json()).resolves.toMatchObject({
        id: "evaluator_1",
        platformUrl:
          "https://app.langwatch.test/project-one/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
      });
    });

    it("answers 404 when the project has no evaluator by that name", async () => {
      const { hono } = buildApi({ tryGetByIdOrSlugWithFields: vi.fn(async () => null) });

      const response = await hono.request("/api/evaluators/ghost");

      expect(response.status).toBe(404);
    });
  });

  describe("when an evaluator is updated", () => {
    it("sends only the fields the caller named", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(response.status).toBe(200);
      expect(stub.update).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "project-1",
        data: { name: "Updated Name" },
      });
    });

    it("keeps the canonical config shape on a settings-only update", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          config: { settings: { model: "openai/gpt-5-mini", prompt: "Judge it" } },
        }),
      });

      expect(response.status).toBe(200);
      // The stored `evaluatorType` survives a body that never mentioned it.
      expect(stub.update).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "project-1",
        data: {
          config: {
            evaluatorType: "langevals/exact_match",
            settings: { model: "openai/gpt-5-mini", prompt: "Judge it" },
          },
        },
      });
    });

    it("refuses a body that changes the evaluator's type", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ config: { evaluatorType: "openai/moderation" } }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("evaluatorType cannot be changed"),
      });
      expect(stub.update).not.toHaveBeenCalled();
    });

    it("accepts a body that repeats the type it already has", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          config: { evaluatorType: "langevals/exact_match", settings: { newSetting: true } },
        }),
      });

      expect(response.status).toBe(200);
    });

    it("answers 404 without writing when the project has no such evaluator", async () => {
      const { hono, stub } = buildApi({ tryGetById: vi.fn(async () => null) });

      const response = await hono.request("/api/evaluators/nonexistent-id", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(response.status).toBe(404);
      expect(stub.update).not.toHaveBeenCalled();
    });
  });

  describe("when an evaluator is archived", () => {
    it("archives it and answers success", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/evaluators/evaluator_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(stub.archive).toHaveBeenCalledWith({ id: "evaluator_1", projectId: "project-1" });
    });

    it("answers 404 without archiving when the project has no such evaluator", async () => {
      const { hono, stub } = buildApi({ tryGetById: vi.fn(async () => null) });

      const response = await hono.request("/api/evaluators/nonexistent-id", { method: "DELETE" });

      expect(response.status).toBe(404);
      expect(stub.archive).not.toHaveBeenCalled();
    });
  });

  describe("when a create names a type the catalog does not have", () => {
    const staleSlug = {
      name: "quick-relevancy",
      // The catalog's current name is `ragas/response_relevancy`; an agent
      // reached for the old one and got a rejection it could not act on.
      config: { evaluatorType: "ragas/answer_relevancy" },
    };

    /** @scenario Unknown evaluator type is rejected naming the exact field */
    it("answers 422 validation_error naming config.evaluatorType, not the whole config", async () => {
      const { hono, stub } = buildApi();

      const response = await post(hono, staleSlug);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: "validation_error",
        fields: ["config.evaluatorType"],
      });
      expect(stub.createWithResolvedDefaults).not.toHaveBeenCalled();
    });

    /** @scenario The rejection lists every type that would have been accepted */
    it("carries every accepted evaluator type as the reason's meta.expected", async () => {
      const { hono } = buildApi();

      const body = (await (await post(hono, staleSlug)).json()) as {
        reasons: { code: string; meta: Record<string, unknown> }[];
      };
      const [reason] = body.reasons;

      expect(reason?.code).toBe("schema_failure");
      expect(reason?.meta.field).toBe("config.evaluatorType");
      expect(reason?.meta.expected).toEqual(Object.keys(AVAILABLE_EVALUATORS).sort());
      expect(reason?.meta.received).toBe("ragas/answer_relevancy");
    });

    /** @scenario The rejection lists every type that would have been accepted */
    it("names the current ragas slug that replaces the stale one", async () => {
      const { hono } = buildApi();

      const body = (await (await post(hono, staleSlug)).json()) as {
        reasons: { meta: { expected: string[] } }[];
      };

      expect(body.reasons[0]?.meta.expected).toContain("ragas/response_relevancy");
    });

    /** @scenario The accepted types stay out of the prose message */
    it("keeps the accepted types out of the prose message", async () => {
      const { hono } = buildApi();

      const body = (await (await post(hono, staleSlug)).json()) as {
        reasons: { meta: { message: string } }[];
      };

      expect(body.reasons[0]?.meta.message).not.toContain("ragas/response_relevancy");
    });
  });

  describe("when a create names no type at all", () => {
    it("still rejects with the field requirement it always had", async () => {
      const { hono } = buildApi();

      const response = await post(hono, { name: "quick-relevancy", config: {} });

      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        error: string;
        reasons: { meta: { message: string } }[];
      };
      expect(body.error).toBe("validation_error");
      expect(body.reasons[0]?.meta.message).toContain("evaluatorType");
    });
  });

  describe("when a create names a type the catalog does have", () => {
    it("passes the body through to the application unchanged", async () => {
      const { hono, stub } = buildApi();

      const response = await post(hono, {
        name: "quick-relevancy",
        config: { evaluatorType: "ragas/response_relevancy" },
      });

      expect(response.status).toBe(200);
      expect(stub.createWithResolvedDefaults).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "quick-relevancy",
        config: { evaluatorType: "ragas/response_relevancy" },
      });
    });

    it("accepts the platform's native evaluators, not only the langevals catalog", async () => {
      const { hono } = buildApi();

      const response = await post(hono, {
        name: "secrets-check",
        config: { evaluatorType: "langwatch/api_keys_and_secrets_detection" },
      });

      expect(response.status).toBe(200);
    });
  });
});
