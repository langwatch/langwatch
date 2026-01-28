/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import type { LiteLLMParams, TargetAdapterData } from "../types";
import {
  createAdapter,
  SERIALIZED_ADAPTER_FACTORIES,
} from "../serialized-adapter.registry";
import {
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "../serialized.adapters";

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
      };

      const adapter = createAdapter({
        adapterData,
        modelParams: defaultModelParams,
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
      };

      const adapter = createAdapter({
        adapterData,
        modelParams: defaultModelParams,
        nlpServiceUrl,
      });

      expect(adapter).toBeInstanceOf(SerializedHttpAgentAdapter);
    });
  });

  describe("unknown adapter type", () => {
    it("throws descriptive error for unknown adapter type", () => {
      const adapterData = {
        type: "unknown-type",
      } as unknown as TargetAdapterData;

      expect(() =>
        createAdapter({
          adapterData,
          modelParams: defaultModelParams,
          nlpServiceUrl,
        }),
      ).toThrow("Unknown adapter type: unknown-type");
    });
  });

  describe("SERIALIZED_ADAPTER_FACTORIES registry", () => {
    it("has factory for prompt type", () => {
      expect(SERIALIZED_ADAPTER_FACTORIES["prompt"]).toBeDefined();
    });

    it("has factory for http type", () => {
      expect(SERIALIZED_ADAPTER_FACTORIES["http"]).toBeDefined();
    });
  });
});
