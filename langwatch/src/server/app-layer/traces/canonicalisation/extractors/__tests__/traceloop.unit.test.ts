import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { TraceloopExtractor } from "../traceloop";
import { createExtractorContext } from "./_testHelpers";

describe("TraceloopExtractor", () => {
  const extractor = new TraceloopExtractor();

  describe("when traceloop.span.kind is present", () => {
    it("maps llm to langwatch.span.type llm", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.TRACELOOP_SPAN_KIND]: "llm",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("maps tool to langwatch.span.type tool", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.TRACELOOP_SPAN_KIND]: "tool",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("consumes traceloop.span.kind even when langwatch.span.type already set", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.TRACELOOP_SPAN_KIND]: "llm",
      });

      extractor.apply(ctx);

      // Span type should not be overwritten
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
      // But the attribute should be consumed
      expect(ctx.bag.attrs.has(ATTR_KEYS.TRACELOOP_SPAN_KIND)).toBe(false);
    });
  });

  describe("when traceloop.entity.input is present", () => {
    it("maps to gen_ai.input.messages", () => {
      const messages = [{ role: "user", content: "Hello" }];
      const ctx = createExtractorContext({
        [ATTR_KEYS.TRACELOOP_ENTITY_INPUT]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual(
        JSON.stringify(messages),
      );
    });

    it("does not overwrite existing gen_ai.input.messages", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.GEN_AI_INPUT_MESSAGES]: JSON.stringify([
          { role: "user", content: "existing" },
        ]),
        [ATTR_KEYS.TRACELOOP_ENTITY_INPUT]: JSON.stringify([
          { role: "user", content: "traceloop" },
        ]),
      });

      extractor.apply(ctx);

      // Should not overwrite — gen_ai.input.messages already in bag
      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
    });
  });

  describe("when traceloop.entity.output is present", () => {
    it("maps to gen_ai.output.messages", () => {
      const messages = [{ role: "assistant", content: "Hi there" }];
      const ctx = createExtractorContext({
        [ATTR_KEYS.TRACELOOP_ENTITY_OUTPUT]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual(
        JSON.stringify(messages),
      );
    });
  });
});
