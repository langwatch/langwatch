/**
 * @vitest-environment node
 */

import type { LiteLLMParams, TargetAdapterData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  SerializedAgentChannelRegistry,
  HttpSerializedCodeAgentChannel,
  HttpSerializedHttpAgentChannel,
  HttpSerializedPromptConfigChannel,
} from "../index.ts";

describe("SerializedAgentRegistryAdapter", () => {
  const defaultModelParams: LiteLLMParams = {
    api_key: "test-key",
    model: "openai/gpt-4",
  };
  const nlpServiceUrl = "http://localhost:8080";

  describe("given a prompt-type adapter", () => {
    it("creates HttpSerializedPromptConfigChannel for prompt type", () => {
      const adapterData: TargetAdapterData = {
        type: "prompt",
        promptId: "prompt_123",
        systemPrompt: "You are helpful.",
        messages: [],
        inputs: [],
      };

      const adapter = SerializedAgentChannelRegistry.create().build({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(HttpSerializedPromptConfigChannel);
    });
  });

  describe("given an http-type adapter", () => {
    it("creates HttpSerializedHttpAgentChannel for http type", () => {
      const adapterData: TargetAdapterData = {
        type: "http",
        agentId: "agent_123",
        url: "https://api.example.com/chat",
        method: "POST",
        headers: [],
        secrets: {},
      };

      const adapter = SerializedAgentChannelRegistry.create().build({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(HttpSerializedHttpAgentChannel);
    });
  });

  describe("given a code-type adapter", () => {
    it("creates HttpSerializedCodeAgentChannel for code type", () => {
      const adapterData: TargetAdapterData = {
        type: "code",
        agentId: "agent_456",
        code: 'def execute(input):\n    return f"processed: {input}"',
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        secrets: {},
      };

      const adapter = SerializedAgentChannelRegistry.create().build({
        adapterData,
        modelParams: defaultModelParams,
        projectApiKey: "lw-project-key",
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(HttpSerializedCodeAgentChannel);
    });
  });
});
