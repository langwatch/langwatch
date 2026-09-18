/**
 * `POST /api/scenario/generate` binds body projectId to the declared permission target.
 * @vitest-environment node
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { ScenarioApi, type ScenarioGenerateResponse } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { scenarioGenerateRest } from "../scenario-generate.rest.ts";

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }

  return context.json({ error: "internal_server_error" }, 500);
};

function buildApi(permitted = true) {
  const generateScenario = vi.fn<ScenarioApi["generateScenario"]>(async () => ({
    scenario: {
      name: "Refund request",
      situation: "A customer needs a refund.",
      criteria: ["The agent confirms the request."],
    },
  }));
  const app = createApiFixture<ScenarioApi>({ generateScenario });
  const authorize = vi.fn(() => ({ permitted, organizationRole: null }));
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: { type: "user", id: "user_1" }, scope: null }),
      authorize,
    },
  });
  const hono = runtime.mount(scenarioGenerateRest.router(), {
    app: () => app,
    onError: boundaryErrorHandler,
  });
  const generate = (projectId = "project_1") =>
    hono.request("http://api.test/api/scenario/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "a grumpy refund requester",
        currentScenario: null,
        projectId,
      }),
    });

  return { authorize, generate, generateScenario };
}

describe("POST /api/scenario/generate", () => {
  describe("given the caller may manage the body project", () => {
    /** @scenario "Generate scenario with AI using custom description" */
    it("forwards the parsed request to the composed Scenario API", async () => {
      const { authorize, generate, generateScenario } = buildApi();

      const response = await generate("project_other");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual<ScenarioGenerateResponse>({
        scenario: {
          name: "Refund request",
          situation: "A customer needs a refund.",
          criteria: ["The agent confirms the request."],
        },
      });
      expect(generateScenario).toHaveBeenCalledWith({
        prompt: "a grumpy refund requester",
        currentScenario: null,
        projectId: "project_other",
      });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "scenarios:manage",
          target: { tier: "project", id: "project_other" },
        }),
      );
    });
  });

  describe("given the caller lacks scenarios:manage on the body project", () => {
    /** @scenario "Generate scenario with AI using custom description" */
    it("refuses before calling the composed application", async () => {
      const { authorize, generate, generateScenario } = buildApi(false);

      const response = await generate();

      expect(response.status).toBe(403);
      expect(generateScenario).not.toHaveBeenCalled();
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "scenarios:manage",
          target: { tier: "project", id: "project_1" },
        }),
      );
    });
  });
});
