import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  WorkflowAiCall,
  WorkflowCommitMessageModel,
  type WorkflowAiCallFeature,
} from "../../app/workflow.app.ts";
import { WorkflowCommitMessageService } from "../workflow-commit-message.service.ts";

// Regression: commit-message autogen sent function tools + reasoning_effort
// to /v1/chat/completions, which the gpt-5 family rejects ("use /v1/responses
// instead"). A commit message is one short string, so generation must be a
// plain-text completion with no function-tool round-trip.

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateText }));

class StubModels implements WorkflowCommitMessageModel {
  readonly asked: { projectId: string; featureKey: string }[] = [];

  resolve(input: { projectId: string; featureKey: string }): Promise<LanguageModel> {
    this.asked.push(input);
    return Promise.resolve("openai/gpt-5-mini");
  }
}

class PassThroughAiCalls implements WorkflowAiCall {
  readonly features: WorkflowAiCallFeature[] = [];

  run<T>(feature: WorkflowAiCallFeature, call: () => Promise<T>): Promise<T> {
    this.features.push(feature);
    return call();
  }
}

function serviceWith(): {
  service: WorkflowCommitMessageService;
  models: StubModels;
  aiCalls: PassThroughAiCalls;
} {
  const models = new StubModels();
  const aiCalls = new PassThroughAiCalls();
  return {
    service: WorkflowCommitMessageService.create({ models, aiCalls }),
    models,
    aiCalls,
  };
}

const change = {
  projectId: "project_abc123",
  previousDsl: '{\n  "description": "A description"\n}',
  nextDsl: '{\n  "description": "A different description"\n}',
};

describe("WorkflowCommitMessageService", () => {
  describe("when generating against a reasoning model", () => {
    /** @scenario Commit-message generation works for reasoning models */
    it("requests a plain-text completion without function tools", async () => {
      generateText.mockReset();
      generateText.mockResolvedValue({ text: "  shorten prompt  " });
      const { service } = serviceWith();

      const result = await service.generate(change);

      expect(generateText).toHaveBeenCalledTimes(1);
      const callArg = generateText.mock.calls[0]![0] as Record<string, unknown>;
      // The combination that gpt-5 rejects on /v1/chat/completions is exactly
      // function tools + reasoning_effort. No tools here, so it never trips.
      expect(callArg).not.toHaveProperty("tools");
      expect(callArg).not.toHaveProperty("toolChoice");
      expect(callArg.providerOptions).toEqual({ openai: { reasoningEffort: "low" } });
      // The trimmed completion text is returned directly.
      expect(result).toBe("shorten prompt");
    });

    it("resolves the model under the commit-message feature key", async () => {
      generateText.mockReset();
      generateText.mockResolvedValue({ text: "shorten prompt" });
      const { service, models, aiCalls } = serviceWith();

      await service.generate(change);

      expect(models.asked).toEqual([
        { projectId: "project_abc123", featureKey: "workflows.commit_message" },
      ]);
      expect(aiCalls.features.map((feature) => feature.key)).toEqual(["workflows.commit_message"]);
    });

    it("shows the model the change as a patch over the previous graph", async () => {
      generateText.mockReset();
      generateText.mockResolvedValue({ text: "shorten prompt" });
      const { service } = serviceWith();

      await service.generate(change);

      const messages = (generateText.mock.calls[0]![0] as { messages: { content: string }[] })
        .messages;
      expect(messages[0]!.content).toContain("LangWatch Optimization Studio");
      expect(messages[1]!.content).toContain(change.previousDsl);
      expect(messages[1]!.content).toContain('-  "description": "A description"');
      expect(messages[1]!.content).toContain('+  "description": "A different description"');
    });
  });

  describe("when the provider fails", () => {
    it("runs the call through the failure policy so it surfaces typed", async () => {
      generateText.mockReset();
      generateText.mockRejectedValue(new Error("provider 500"));
      const models = new StubModels();
      const aiCalls = new (class implements WorkflowAiCall {
        async run<T>(_feature: WorkflowAiCallFeature, call: () => Promise<T>): Promise<T> {
          try {
            return await call();
          } catch {
            throw new Error("ai_call_failed");
          }
        }
      })();
      const service = WorkflowCommitMessageService.create({ models, aiCalls });

      await expect(service.generate(change)).rejects.toThrow("ai_call_failed");
    });
  });
});
