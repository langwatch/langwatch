import { ModelExecutionUnavailableError } from "@langwatch/model-provider-contract";
/**
 * @vitest-environment node
 * Which failures keep their own code through the AI-call wrapper.
 */
import { describe, expect, it } from "vitest";

import { AiCallFailureService } from "../ai-call-failure.service.ts";

const FEATURE = {
  key: "langy.conversation_title",
  role: "FAST" as const,
  displayName: "Langy chat titles",
};

describe("AiCallFailureService", () => {
  describe("when the call is refused because the process cannot execute the model", () => {
    /** @scenario "A codex model this process cannot execute is refused with a typed code" */
    it("passes the refusal through with its own code", async () => {
      const refusal = new ModelExecutionUnavailableError({
        model: "openai_codex/gpt-5.6-terra",
        featureKey: FEATURE.key,
      });

      await expect(
        AiCallFailureService.create().wrapAiCall(FEATURE, async () => {
          throw refusal;
        }),
      ).rejects.toMatchObject({ code: "model_execution_unavailable" });
    });
  });

  describe("when the call fails for an unnamed reason", () => {
    it("rethrows it as ai_call_failed", async () => {
      await expect(
        AiCallFailureService.create().wrapAiCall(FEATURE, async () => {
          throw new Error("socket hang up");
        }),
      ).rejects.toMatchObject({ code: "ai_call_failed" });
    });
  });
});
