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

  describe("when instrumentationScope.name is @mastra/otel-bridge", () => {
    const mastraBridgeScope = {
      instrumentationScope: { name: "@mastra/otel-bridge", version: null },
    };

    it("maps agent_run to agent", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run" },
        mastraBridgeScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("agent");
    });

    it("maps processor_run to span", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "processor_run" },
        mastraBridgeScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("span");
    });

    it("maps model_generation to llm", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_generation" },
        mastraBridgeScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when detected by mastra.span.type attribute only", () => {
    it("maps span type even without @mastra/* scope", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "tool_call" },
        { instrumentationScope: { name: "unknown-scope", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("maps model_step to llm without @mastra/* scope", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step" },
        { instrumentationScope: { name: "other-lib", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when instrumentationScope.name is NOT mastra and no mastra attributes", () => {
    it("does nothing (no span type set)", () => {
      const ctx = createExtractorContext(
        {},
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

  describe("when agent_run span has mastra.agent_run.input", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("extracts last user message as langwatch.input", () => {
      const messages = JSON.stringify([
        { role: "system", content: "You are a weather assistant" },
        { role: "user", content: [{ type: "text", text: "what's the weather in london?" }] },
      ]);
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_INPUT]: messages,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe(
        "what's the weather in london?",
      );
    });

    it("extracts last user message with string content", () => {
      const messages = JSON.stringify([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hello world" },
      ]);
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_INPUT]: messages,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe("hello world");
    });

    it("picks the last user message when multiple exist", () => {
      const messages = JSON.stringify([
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
      ]);
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_INPUT]: messages,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe("second question");
    });

    it("does not set langwatch.input when langwatch.input already exists", () => {
      const messages = JSON.stringify([
        { role: "user", content: "from mastra" },
      ]);
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_INPUT]: messages,
          [ATTR_KEYS.LANGWATCH_INPUT]: "already set",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBeUndefined();
    });
  });

  describe("when model_step span has mastra.model_step.output", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("extracts text field as langwatch.output", () => {
      const output = JSON.stringify({
        text: "The current weather in London is sunny, 15°C.",
        toolCalls: [],
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe(
        "The current weather in London is sunny, 15°C.",
      );
    });

    it("does not set langwatch.output for empty text", () => {
      const output = JSON.stringify({ text: "", toolCalls: [] });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBeUndefined();
    });

    it("does not set langwatch.output when already exists", () => {
      const output = JSON.stringify({ text: "from mastra", toolCalls: [] });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
          [ATTR_KEYS.LANGWATCH_OUTPUT]: "already set",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBeUndefined();
    });

    it("does not set langwatch.output for agent_run spans", () => {
      const output = JSON.stringify({ text: "concatenated text" });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBeUndefined();
    });
  });
});
