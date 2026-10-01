import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { WorkflowCommitMessageService } from "../workflow-commit-message.service.ts";

// Regression: commit-message autogen sent function tools + reasoning_effort to
// /v1/chat/completions, which the gpt-5 family rejects. A commit message is one
// short string, so generation is a plain-text completion.

function serviceWith(generateText: ModelProviderApi["generateText"]): WorkflowCommitMessageService {
  return WorkflowCommitMessageService.create({
    modelProviders: createApiFixture<ModelProviderApi>({ generateText }),
  });
}

const change = {
  projectId: "project_abc123",
  previousDsl: '{\n  "description": "A description"\n}',
  nextDsl: '{\n  "description": "A different description"\n}',
};

describe("WorkflowCommitMessageService", () => {
  describe("when generating against a reasoning model", () => {
    /** @scenario Commit-message generation works for reasoning models */
    it("requests a plain-text completion at low reasoning effort", async () => {
      const generateText = vi.fn<ModelProviderApi["generateText"]>();
      generateText.mockResolvedValue({ text: "  shorten prompt  " });

      const result = await serviceWith(generateText).generate(change);

      expect(generateText).toHaveBeenCalledTimes(1);
      expect(generateText.mock.calls[0]![0]).toMatchObject({
        projectId: "project_abc123",
        featureKey: "workflows.commit_message",
        reasoningEffort: "low",
      });
      expect(result).toBe("shorten prompt");
    });

    it("shows the model the change as a patch over the previous graph", async () => {
      const generateText = vi.fn<ModelProviderApi["generateText"]>();
      generateText.mockResolvedValue({ text: "shorten prompt" });

      await serviceWith(generateText).generate(change);

      const request = generateText.mock.calls[0]![0];
      expect(request.system).toContain("LangWatch Optimization Studio");
      expect(request.messages[0]!.content).toContain(change.previousDsl);
      expect(request.messages[0]!.content).toContain('-  "description": "A description"');
      expect(request.messages[0]!.content).toContain('+  "description": "A different description"');
    });
  });

  describe("when the provider fails", () => {
    it("lets the model provider's typed failure through", async () => {
      const failure = Object.assign(new Error("AI call failed"), { code: "ai_call_failed" });
      const generateText = vi.fn<ModelProviderApi["generateText"]>();
      generateText.mockRejectedValue(failure);

      await expect(serviceWith(generateText).generate(change)).rejects.toMatchObject({
        code: "ai_call_failed",
      });
    });
  });
});
