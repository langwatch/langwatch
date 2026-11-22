import {
  isPermanentAiCallFailure,
  ModelExecutionUnavailableError,
  ModelProviderUnavailableError,
  ModelRestrictedForExecutionError,
} from "@langwatch/model-provider-contract";
/**
 * @vitest-environment node
 * Which failures keep their own code through the AI-call wrapper, and which are worth retrying.
 */
import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";

import { AiCallFailureService } from "../ai-call-failure.service.ts";

const FEATURE = {
  key: "langy.conversation_title",
  role: "FAST" as const,
  displayName: "Langy chat titles",
};

function wrapped(failure: unknown): Promise<unknown> {
  return AiCallFailureService.create()
    .wrapAiCall(FEATURE, async () => {
      throw failure;
    })
    .catch((error: unknown) => error);
}

function providerAnswered(statusCode: number): APICallError {
  return new APICallError({
    message: `provider answered ${statusCode}`,
    url: "https://provider.example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
  });
}

describe("AiCallFailureService", () => {
  describe("when the call is refused because the process cannot execute the model", () => {
    /** @scenario "A codex model this process cannot execute is refused with a typed code" */
    it("passes the refusal through with its own code", async () => {
      const refusal = new ModelExecutionUnavailableError({
        model: "openai_codex/gpt-5.6-terra",
        featureKey: FEATURE.key,
      });

      await expect(wrapped(refusal)).resolves.toMatchObject({
        code: "model_execution_unavailable",
      });
    });
  });

  describe("when the named model's provider is turned off", () => {
    /** @scenario "A named model whose provider is turned off is refused with a typed code" */
    it("passes the refusal through with its own code", async () => {
      const refusal = new ModelProviderUnavailableError({
        providerKey: "openai",
        reason: "disabled",
      });

      await expect(wrapped(refusal)).resolves.toMatchObject({
        code: "model_provider_unavailable",
      });
    });
  });

  describe("when the provider refuses the request itself", () => {
    /** @scenario "A provider that refuses the request itself is marked as not worth retrying" */
    it.each([400, 401, 403, 404])(
      "rethrows a %i as ai_call_failed, not retryable",
      async (status) => {
        const error = await wrapped(providerAnswered(status));

        expect(error).toMatchObject({ code: "ai_call_failed", retryable: false });
        expect(isPermanentAiCallFailure(error)).toBe(true);
      },
    );
  });

  describe("when the failure is one a retry could fix", () => {
    /** @scenario "A provider failure a retry could fix stays retryable" */
    it.each([
      ["a 500", providerAnswered(500)],
      ["a 503", providerAnswered(503)],
      ["a 429", providerAnswered(429)],
      ["a 408", providerAnswered(408)],
      ["a dropped connection", new Error("socket hang up")],
      [
        "retries that ran out on a 503",
        new RetryError({
          message: "Failed after 2 attempts",
          reason: "maxRetriesExceeded",
          errors: [providerAnswered(503), providerAnswered(503)],
        }),
      ],
    ])("rethrows %s as ai_call_failed, still retryable", async (_label, failure) => {
      const error = await wrapped(failure);

      expect(error).toMatchObject({ code: "ai_call_failed", retryable: true });
      expect(isPermanentAiCallFailure(error)).toBe(false);
    });
  });

  describe("when the call fails with a handled error the wrapper does not pass through", () => {
    /** @scenario "A wrapped AI call failure keeps the code of the failure it wraps" */
    it("keeps that code on the reason chain", async () => {
      const restricted = new ModelRestrictedForExecutionError({
        model: "openai_codex/gpt-5.6-terra",
        provider: "openai_codex",
        featureKey: FEATURE.key,
      });

      const error = await wrapped(restricted);

      expect(error).toMatchObject({
        code: "ai_call_failed",
        reasons: [{ code: "model_restricted_for_execution" }],
      });
      expect(isPermanentAiCallFailure(error)).toBe(true);
    });
  });
});
