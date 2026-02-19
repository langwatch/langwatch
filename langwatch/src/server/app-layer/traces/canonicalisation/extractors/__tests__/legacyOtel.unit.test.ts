import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { LegacyOtelTracesExtractor } from "../legacyOtel";
import { createExtractorContext } from "./_testHelpers";

describe("LegacyOtelTracesExtractor", () => {
  const extractor = new LegacyOtelTracesExtractor();

  describe("when type attribute is present", () => {
    it("maps to langwatch.span.type", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.TYPE]: "llm",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when span.kind includes SERVER", () => {
    it("sets langwatch.span.type to server", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_KIND]: "SERVER",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("server");
    });
  });

  describe("when llm.request.type is chat", () => {
    it("infers llm span type", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.LLM_REQUEST_TYPE]: "chat",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when input.value is present", () => {
    it("maps to langwatch.input", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.INPUT_VALUE]: "some input data",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.LANGWATCH_INPUT,
        "some input data",
      );
    });

    it("does not overwrite existing langwatch.input", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.INPUT_VALUE]: "legacy input",
      });
      ctx.out[ATTR_KEYS.LANGWATCH_INPUT] = "existing";

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe("existing");
    });
  });

  describe("when output.value is present", () => {
    it("maps to langwatch.output", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OUTPUT_VALUE]: "some output data",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.LANGWATCH_OUTPUT,
        "some output data",
      );
    });
  });

  describe("when ai.toolCall.args is present", () => {
    it("maps to langwatch.input for tool spans", () => {
      const args = JSON.stringify({ query: "test" });
      const ctx = createExtractorContext({
        [ATTR_KEYS.AI_TOOL_CALL_ARGS]: args,
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.LANGWATCH_INPUT,
        { query: "test" },
      );
    });
  });

  describe("when error indicators are present", () => {
    it("extracts error.type from span.error.has_error + span.error.message", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_ERROR_HAS_ERROR]: true,
        [ATTR_KEYS.SPAN_ERROR_MESSAGE]: "Something went wrong",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.ERROR_TYPE,
        "Something went wrong",
      );
    });

    it("extracts error.type from exception.type + exception.message", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.EXCEPTION_TYPE]: "ValueError",
        [ATTR_KEYS.EXCEPTION_MESSAGE]: "Invalid input",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.ERROR_TYPE,
        "ValueError: Invalid input",
      );
    });

    it("extracts error.type from status.message as fallback", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.STATUS_MESSAGE]: "Request failed",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.ERROR_TYPE,
        "Request failed",
      );
    });
  });
});
