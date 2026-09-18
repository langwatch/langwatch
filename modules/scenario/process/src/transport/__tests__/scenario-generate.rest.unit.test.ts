/**
 * `POST /api/scenario/generate` — the author-assist door's per-project
 * generation window: counted after the permission probe, refused before the
 * model is resolved.
 * @vitest-environment node
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { ScenarioGenerateRateLimitedError } from "@langwatch/scenario-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import {
  createScenarioGenerateRest,
  type ScenarioGenerateRestSession,
} from "../scenario-generate.rest.ts";

const SESSION: ScenarioGenerateRestSession = { user: { id: "user_1" } };

/** The door's collaborator bag, derived so the test never names the port shape. */
type GenerateRestCollaborators = Parameters<typeof createScenarioGenerateRest>[0];

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json(
      { code: error.code },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return context.json({ error: "internal_server_error" }, 500);
};

function buildApi(overrides: Partial<GenerateRestCollaborators> = {}) {
  const resolveModel = vi.fn(async () => {
    throw new Error("the test never resolves a real model");
  });
  const assertGenerateWithinBounds = vi.fn(async () => {});

  const ports: GenerateRestCollaborators = {
    resolveSession: async () => SESSION,
    probeProjectPermission: async () => true,
    assertGenerateWithinBounds,
    resolveModel,
    timeoutMs: () => 1_000,
    ...overrides,
  };

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: null, scope: null }),
    },
  });

  const hono = runtime.mount(createScenarioGenerateRest(ports).router(), {
    app: () => ({}) as never,
    onError: boundaryErrorHandler,
  });

  const generate = (body: Record<string, unknown> = {}) =>
    hono.request("http://api.test/api/scenario/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `currentScenario` is nullable but not optional on the wire schema.
      body: JSON.stringify({
        prompt: "a grumpy refund requester",
        currentScenario: null,
        projectId: "project_1",
        ...body,
      }),
    });

  return { generate, resolveModel, assertGenerateWithinBounds };
}

describe("POST /api/scenario/generate", () => {
  describe("given the project has spent its generation window", () => {
    it("refuses 429 and never resolves the model", async () => {
      const { generate, resolveModel } = buildApi({
        assertGenerateWithinBounds: async () => {
          throw new ScenarioGenerateRateLimitedError({ retryAfterSeconds: 42 });
        },
      });

      const response = await generate();

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "scenario_generate_rate_limited" });
      expect(resolveModel).not.toHaveBeenCalled();
    });
  });

  describe("given the caller lacks scenarios:manage on the project", () => {
    it("refuses before the budget is counted", async () => {
      const { generate, assertGenerateWithinBounds } = buildApi({
        probeProjectPermission: async () => false,
      });

      const response = await generate();

      expect(response.status).toBe(403);
      expect(assertGenerateWithinBounds).not.toHaveBeenCalled();
    });
  });

  describe("given the budget check passes", () => {
    it("counts the generation against the project the body names", async () => {
      const { generate, assertGenerateWithinBounds } = buildApi();

      await generate({ projectId: "project_other" });

      expect(assertGenerateWithinBounds).toHaveBeenCalledWith({ projectId: "project_other" });
    });
  });
});
