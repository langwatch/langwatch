/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { createAdapter } from "../index";
import {
  SerializedCodeAgentAdapter,
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "../index";
import type { LiteLLMParams, TargetAdapterData } from "@langwatch/scenario-contract";

describe("createAdapter", () => {
  const defaultModelParams: LiteLLMParams = {
    api_key: "test-key",
    model: "openai/gpt-4",
  };
  const nlpServiceUrl = "http://localhost:8080";

  describe("prompt adapter", () => {
    it("creates SerializedPromptConfigAdapter for prompt type", () => {
      const adapterData: TargetAdapterData = {
        type: "prompt",
        promptId: "prompt_123",
        systemPrompt: "You are helpful.",
        messages: [],
        inputs: [],
      };

      const adapter = createAdapter({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(SerializedPromptConfigAdapter);
    });
  });

  describe("http adapter", () => {
    it("creates SerializedHttpAgentAdapter for http type", () => {
      const adapterData: TargetAdapterData = {
        type: "http",
        agentId: "agent_123",
        url: "https://api.example.com/chat",
        method: "POST",
        headers: [],
        secrets: {},
      };

      const adapter = createAdapter({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(SerializedHttpAgentAdapter);
    });
  });

  describe("code adapter", () => {
    it("creates SerializedCodeAgentAdapter for code type", () => {
      const adapterData: TargetAdapterData = {
        type: "code",
        agentId: "agent_456",
        code: 'def execute(input):\n    return f"processed: {input}"',
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        secrets: {},
      };

      const adapter = createAdapter({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(SerializedCodeAgentAdapter);
    });
  });
});
