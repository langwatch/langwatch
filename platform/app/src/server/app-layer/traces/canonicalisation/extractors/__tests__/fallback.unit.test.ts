import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { FallbackExtractor } from "../fallback";
import { createExtractorContext } from "./_testHelpers";

describe("FallbackExtractor", () => {
  const extractor = new FallbackExtractor();

  describe("when no span type set and tool indicators present", () => {
    it("infers tool from operation.name = ai.toolCall", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPERATION_NAME]: "ai.toolCall",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("infers tool from ai.toolCall.name presence", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.AI_TOOL_CALL_NAME]: "search",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("infers tool from gen_ai.operation.name = tool", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "tool",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });
  });

  describe("when no span type set and agent indicators present", () => {
    it("infers agent from gen_ai.agent.name presence", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_AGENT_NAME]: "my-agent",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("agent");
    });
  });

  describe("when no span type set and LLM indicators present", () => {
    it("infers llm from gen_ai.request.model", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "gpt-4",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("infers llm from ai.prompt (Vercel)", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.AI_PROMPT]: "Hello",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("infers llm from llm.model_name (legacy)", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_MODEL_NAME]: "claude-3",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when span type already set", () => {
    it("does nothing", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "gpt-4",
      });

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });
});
