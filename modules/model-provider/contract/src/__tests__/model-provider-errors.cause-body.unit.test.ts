import { describe, expect, it } from "vitest";

import {
  AiCallFailedError,
  ModelNotConfiguredError,
  ModelProviderDisabledError,
} from "../model-provider.errors.ts";

/** The tRPC `data.cause` bytes main's error formatter wrote, key order included. */
describe("the cause body a model-provider error renders for the tRPC wire", () => {
  describe("given no model is configured", () => {
    it("writes main's MODEL_NOT_CONFIGURED body", () => {
      const error = new ModelNotConfiguredError({
        featureKey: "traces.ai_search",
        role: "FAST",
        featureDisplayName: "AI search",
        projectId: "project-1",
      });

      expect(JSON.stringify(error.toResponseBody())).toBe(
        JSON.stringify({
          code: "MODEL_NOT_CONFIGURED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
          projectId: "project-1",
        }),
      );
    });
  });

  describe("given the provider call failed", () => {
    it("writes main's AI_CALL_FAILED body and never the provider's own text", () => {
      const error = new AiCallFailedError({
        featureKey: "traces.ai_search",
        role: "FAST",
        featureDisplayName: "AI search",
        originalErrorMessage: "Incorrect API key provided: sk-proj-secret",
      });

      const body = JSON.stringify(error.toResponseBody());

      expect(body).toBe(
        JSON.stringify({
          code: "AI_CALL_FAILED",
          featureKey: "traces.ai_search",
          featureDisplayName: "AI search",
          role: "FAST",
        }),
      );
      expect(body).not.toContain("sk-proj-secret");
    });
  });

  describe("given the resolved provider is disabled", () => {
    it("writes main's MODEL_PROVIDER_DISABLED body", () => {
      const error = new ModelProviderDisabledError({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "project-1",
        resolvedScope: "project",
        resolvedModel: "openai/gpt-4o",
        providerKey: "openai",
        alternate: null,
      });

      expect(error.toResponseBody()).toMatchObject({
        code: "MODEL_PROVIDER_DISABLED",
        providerKey: "openai",
        alternate: null,
      });
    });
  });
});
