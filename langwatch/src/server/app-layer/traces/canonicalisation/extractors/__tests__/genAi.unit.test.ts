import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { GenAIExtractor } from "../genAi";
import { createExtractorContext } from "./_testHelpers";

describe("GenAIExtractor", () => {
  const extractor = new GenAIExtractor();

  describe("when gen_ai.system is present", () => {
    it("maps to gen_ai.provider.name and consumes original", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_SYSTEM]: "openai",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_PROVIDER_NAME]).toBe("openai");
      expect(ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_SYSTEM)).toBe(false);
    });
  });

  describe("when gen_ai.agent.name is present", () => {
    it("passes through as-is", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_AGENT_NAME]: "my-agent",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_AGENT_NAME]).toBe("my-agent");
    });
  });

  describe("when gen_ai.agent (legacy) is present", () => {
    it("maps to gen_ai.agent.name", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_AGENT]: "legacy-agent",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_AGENT_NAME]).toBe("legacy-agent");
    });
  });

  describe("when agent.name is present", () => {
    it("maps to gen_ai.agent.name", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.AGENT_NAME]: "named-agent",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_AGENT_NAME]).toBe("named-agent");
    });
  });

  describe("when llm.model_name is present", () => {
    it("maps to both gen_ai.request.model and gen_ai.response.model", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_MODEL_NAME]: "gpt-4",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("gpt-4");
      expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_MODEL]).toBe("gpt-4");
    });
  });

  describe("when gen_ai.prompt is present", () => {
    it("maps to gen_ai.input.messages as user message", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_PROMPT]: "What is 2+2?",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
        { role: "user", content: "What is 2+2?" },
      ]);
    });

    it("extracts system instruction from first system message", () => {
      const messages = [
        { role: "system", content: "You are a math tutor." },
        { role: "user", content: "Hi" },
      ];
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_PROMPT]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION]).toBe(
        "You are a math tutor.",
      );
    });
  });

  describe("when gen_ai.completion is present", () => {
    it("maps to gen_ai.output.messages as assistant message", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_COMPLETION]: "The answer is 4.",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: "The answer is 4." },
      ]);
    });
  });

  describe("when llm.input_messages is present", () => {
    it("maps to gen_ai.input.messages", () => {
      const messages = [{ role: "user", content: "Hello" }];
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_INPUT_MESSAGES]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual(messages);
    });
  });

  describe("when llm.output_messages is present", () => {
    it("maps to gen_ai.output.messages", () => {
      const messages = [{ role: "assistant", content: "Hi there" }];
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_OUTPUT_MESSAGES]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual(messages);
    });
  });

  describe("when usage tokens are present", () => {
    it("maps gen_ai.usage.input_tokens", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]: 100,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100);
    });

    it("maps gen_ai.usage.prompt_tokens (legacy) to input_tokens", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS]: 50,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(50);
    });

    it("maps gen_ai.usage.output_tokens", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]: 200,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(200);
    });

    it("maps gen_ai.usage.completion_tokens (legacy) to output_tokens", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS]: 75,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(75);
    });
  });

  describe("when llm.invocation_parameters JSON is present", () => {
    it("extracts temperature, max_tokens, top_p, frequency_penalty, presence_penalty, seed", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_INVOCATION_PARAMETERS]: JSON.stringify({
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.9,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          seed: 42,
        }),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE]).toBe(0.7);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS]).toBe(1000);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_TOP_P]).toBe(0.9);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY]).toBe(0.5);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY]).toBe(0.3);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_SEED]).toBe(42);
    });

    it("extracts stop sequences as string array", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_INVOCATION_PARAMETERS]: JSON.stringify({
          stop: ["END", "STOP"],
        }),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_STOP_SEQUENCES]).toEqual([
        "END",
        "STOP",
      ]);
    });

    it("skips choice count when n=1", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_INVOCATION_PARAMETERS]: JSON.stringify({ n: 1 }),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_CHOICE_COUNT]).toBeUndefined();
    });

    it("sets choice count when n>1", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_INVOCATION_PARAMETERS]: JSON.stringify({ n: 3 }),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_CHOICE_COUNT]).toBe(3);
    });
  });

  describe("when span type is llm", () => {
    it("sets gen_ai.operation.name to chat", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "llm",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME]).toBe("chat");
    });
  });

  describe("when span type is tool", () => {
    it("sets gen_ai.operation.name to tool", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "tool",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME]).toBe("tool");
    });
  });
});
