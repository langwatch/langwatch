/**
 * @vitest-environment node
 *
 * The `/api/evaluators` family over the runtime a process mounts it on: the
 * addresses, the statuses and the bodies the public API has answered since it
 * shipped, against a stubbed application.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  AVAILABLE_EVALUATORS,
  type Evaluator,
  type EvaluatorApi,
} from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { createEvaluatorRest } from "../evaluator.rest.ts";

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
 * The process's own boundary renderer, reduced to what these tests read back. A
 * handled error keeps its own status and code, and its `meta` is spread onto
 * the body — which is what puts `fields` beside `error` on a rejected request.
 */
const renderHandled: RestErrorHandler = (error, c) => {
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

  return c.json({ error: "internal_server_error" }, 500);
};

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

function buildApi(overrides: Record<string, unknown> = {}) {
  const stub = {
    getAllWithFields: vi.fn(async () => [enriched]),
    findByIdOrSlugWithFields: vi.fn(async () => enriched),
    getByIdWithFields: vi.fn(async () => enriched),
    findById: vi.fn(async () => evaluator),
    createWithResolvedDefaults: vi.fn(async () => evaluator),
    update: vi.fn(async () => evaluator),
    archive: vi.fn(async () => evaluator),
    ...overrides,
  } as unknown as EvaluatorApi;

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } as const }),
    },
  });
  const hono = runtime.mount(createEvaluatorRest(platformUrl).router(), {
    app: () => stub,
    credential: "projectKey",
    onError: renderHandled,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "project-key-1",
      })),
    ],
  });

  return { hono, stub };
}

const jsonHeaders = { "content-type": "application/json" };

type MountedFamily = ReturnType<typeof buildApi>["hono"];

const request = (hono: MountedFamily, path: string, init?: RequestInit) =>
  hono.fetch(new Request(`http://api.test${path}`, init));

const post = (hono: MountedFamily, body: unknown) =>
  request(hono, "/api/evaluators", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

describe("the evaluators REST family", () => {
  describe("given the dated addressing every route inherits", () => {
    it("answers at the bare path, the dated path and latest alike", async () => {
      const { hono } = buildApi();

      const answered = await Promise.all(
        [
          "/api/evaluators",
          "/api/v1/evaluators",
          "/api/evaluators/2026-08-07",
          "/api/v1/evaluators/2026-08-07",
          "/api/evaluators/latest",
          "/api/v1/evaluators/latest",
        ].map(async (path) => [path, (await request(hono, path)).status] as const),
      );

      expect(answered.filter(([, status]) => status !== 200)).toEqual([]);
    });
  });

  describe("when the project's evaluators are listed", () => {
    it("publishes each one with the address its editor opens at", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators");

      expect(response.status).toBe(200);
      expect(stub.getAllWithFields).toHaveBeenCalledWith({ projectId: "project-1" });
      await expect(response.json()).resolves.toMatchObject([
        {
          id: "evaluator_1",
          platformUrl:
            "https://app.langwatch.test/project-one/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
        },
      ]);
    });
  });

  describe("when one evaluator is read", () => {
    it("asks for it by whichever identifier the caller sent", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators/original-name");

      expect(response.status).toBe(200);
      expect(stub.findByIdOrSlugWithFields).toHaveBeenCalledWith({
        idOrSlug: "original-name",
        projectId: "project-1",
      });
      await expect(response.json()).resolves.toMatchObject({
        id: "evaluator_1",
        platformUrl:
          "https://app.langwatch.test/project-one/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
      });
    });

    /** @scenario "DELETE /api/evaluators/:id archives an evaluator" */
    it("answers 404 when the project has no evaluator by that name", async () => {
      const { hono } = buildApi({ findByIdOrSlugWithFields: vi.fn(async () => void 0) });

      const response = await request(hono, "/api/evaluators/ghost");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "evaluator_not_found" });
    });
  });

  describe("when an evaluator is updated", () => {
    /** @scenario "PUT /api/evaluators/:id updates an evaluator" */
    it("sends only the fields the caller named", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators/evaluator_1", {
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

    /** @scenario Updated settings take effect and the evaluator type is unchanged */
    it("keeps the canonical config shape on a settings-only update", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators/evaluator_1", {
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

    /** @scenario "PUT /api/evaluators/:id updates an evaluator" */
    it("refuses a body that changes the evaluator's type", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ config: { evaluatorType: "openai/moderation" } }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "evaluator_type_immutable",
        message: expect.stringContaining("evaluatorType cannot be changed"),
      });
      expect(stub.update).not.toHaveBeenCalled();
    });

    it("accepts a body that repeats the type it already has", async () => {
      const { hono } = buildApi();

      const response = await request(hono, "/api/evaluators/evaluator_1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          config: { evaluatorType: "langevals/exact_match", settings: { newSetting: true } },
        }),
      });

      expect(response.status).toBe(200);
    });

    it("answers 404 without writing when the project has no such evaluator", async () => {
      const { hono, stub } = buildApi({ findById: vi.fn(async () => void 0) });

      const response = await request(hono, "/api/evaluators/nonexistent-id", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(response.status).toBe(404);
      expect(stub.update).not.toHaveBeenCalled();
    });
  });

  describe("when an evaluator is archived", () => {
    /** @scenario "DELETE /api/evaluators/:id archives an evaluator" */
    it("archives it and answers success", async () => {
      const { hono, stub } = buildApi();

      const response = await request(hono, "/api/evaluators/evaluator_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(stub.archive).toHaveBeenCalledWith({ id: "evaluator_1", projectId: "project-1" });
    });

    it("answers 404 without archiving when the project has no such evaluator", async () => {
      const { hono, stub } = buildApi({ findById: vi.fn(async () => void 0) });

      const response = await request(hono, "/api/evaluators/nonexistent-id", { method: "DELETE" });

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
