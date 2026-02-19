import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { MastraExtractor } from "../mastra";
import { createExtractorContext } from "./_testHelpers";

describe("MastraExtractor", () => {
  const extractor = new MastraExtractor();

  describe("when instrumentationScope.name is @mastra/otel", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("maps agent_run to agent", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("agent");
    });

    it("maps workflow_run to workflow", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "workflow_run" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("workflow");
    });

    it("maps model_generation to llm", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_generation" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("maps tool_call to tool", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "tool_call" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("maps mcp_tool_call to mcp_tool", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "mcp_tool_call" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("mcp_tool");
    });

    it("maps generic to span", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "generic" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("span");
    });

    it("maps unknown types to span (default)", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "something_new" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("span");
    });
  });

  describe("when instrumentationScope.name is NOT @mastra/otel", () => {
    it("does nothing (no span type set)", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run" },
        { instrumentationScope: { name: "other-lib", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });

  describe("when langwatch.span.type already exists", () => {
    it("does not overwrite existing type", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.SPAN_TYPE]: "agent",
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_generation",
        },
        { instrumentationScope: { name: "@mastra/otel", version: null } },
      );

      extractor.apply(ctx);

      // Should not have been called — span type already exists in bag
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
    });
  });
});
