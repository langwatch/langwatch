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

    it("maps mcp_tool_call to tool", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "mcp_tool_call" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
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

    it("maps processor_run to component", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "processor_run" },
        mastraBridgeScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("component");
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

  describe("when langwatch.span.type already exists in bag", () => {
    it("overwrites with Mastra-derived type (Mastra takes precedence)", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.SPAN_TYPE]: "agent",
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_generation",
        },
        { instrumentationScope: { name: "@mastra/otel", version: null } },
      );

      extractor.apply(ctx);

      // Mastra takes precedence — maps model_generation to llm
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
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

  describe("when agent_run span has mastra.agent_run.output", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("extracts text field as langwatch.output", () => {
      const output = JSON.stringify({
        text: "The weather in London is sunny, 15°C.",
        files: [],
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_OUTPUT]: output,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe(
        "The weather in London is sunny, 15°C.",
      );
    });

    it("does not set langwatch.output for empty text", () => {
      const output = JSON.stringify({ text: "", files: [] });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_OUTPUT]: output,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBeUndefined();
    });

    it("does not overwrite existing langwatch.output", () => {
      const output = JSON.stringify({ text: "from mastra", files: [] });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          [ATTR_KEYS.MASTRA_AGENT_RUN_OUTPUT]: output,
          [ATTR_KEYS.LANGWATCH_OUTPUT]: "already set",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBeUndefined();
    });
  });

  describe("when mastra.metadata.* attributes are present", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("maps mastra.metadata.threadId to gen_ai.conversation.id", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          "mastra.metadata.threadId": "thread-abc",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("thread-abc");
    });

    it("does not overwrite existing gen_ai.conversation.id", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          "mastra.metadata.threadId": "mastra-thread",
        },
        mastraScope,
      );

      // Pre-set conversation.id
      ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID] = "existing-thread";

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("existing-thread");
    });

    it("leaves non-threadId metadata keys untouched in the bag", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          "mastra.metadata.runId": "run-42",
          "mastra.metadata.headers": JSON.stringify({ "content-type": "application/json" }),
          "mastra.metadata.body": JSON.stringify({ key: "value" }),
        },
        mastraScope,
      );

      extractor.apply(ctx);

      // Not hoisted to metadata.*
      expect(ctx.out["metadata.runId"]).toBeUndefined();
      expect(ctx.out["metadata.headers"]).toBeUndefined();
      expect(ctx.out["metadata.body"]).toBeUndefined();
      // Still in the bag
      expect(ctx.bag.attrs.has("mastra.metadata.runId")).toBe(true);
      expect(ctx.bag.attrs.has("mastra.metadata.headers")).toBe(true);
      expect(ctx.bag.attrs.has("mastra.metadata.body")).toBe(true);
    });

    it("consumes only threadId from the bag", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run",
          "mastra.metadata.threadId": "t1",
          "mastra.metadata.runId": "r1",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.bag.attrs.has("mastra.metadata.threadId")).toBe(false);
      expect(ctx.bag.attrs.has("mastra.metadata.runId")).toBe(true);
    });
  });

  describe("when gen_ai.usage.cached_input_tokens is present (Mastra non-standard)", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("maps to gen_ai.usage.cache_read.input_tokens", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: "150",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(150);
    });

    it("does not overwrite existing cache_read.input_tokens", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: "150",
        },
        mastraScope,
      );

      // Pre-set canonical name
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = 200;

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(200);
    });

    it("coerces string value to number", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS]: "720",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(720);
      expect(
        typeof ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
      ).toBe("number");
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

    it("sets gen_ai.output.messages as assistant chat message", () => {
      const output = JSON.stringify({
        text: "The answer is 42.",
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

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: "The answer is 42." },
      ]);
    });

    it("records value type for output messages", () => {
      const output = JSON.stringify({
        text: "Hello",
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

      const valueTypes = ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES] as string[];
      expect(valueTypes).toContain("gen_ai.output.messages=chat_messages");
    });

    it("does not set gen_ai.output.messages for eval model_step", () => {
      const output = JSON.stringify({
        object: { score: 9 },
        text: "",
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
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

  describe("when model_step has mastra.model_step.input with body", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("extracts model name from body.model", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hello" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("grok-3-mini");
      expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_MODEL]).toBe("grok-3-mini");
    });

    it("extracts input messages from body.messages with system messages stripped", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "system", content: "You are helpful" },
            { role: "user", content: "What is 2+2?" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
        { role: "user", content: "What is 2+2?" },
      ]);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION]).toBe(
        "You are helpful",
      );
    });

    it("keeps all messages when no system message present", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION]).toBeUndefined();
    });

    it("records value type for input messages", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      const valueTypes = ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES] as string[];
      expect(valueTypes).toContain("gen_ai.input.messages=chat_messages");
    });

    it("extracts system instruction from messages", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "system", content: "You are a math tutor" },
            { role: "user", content: "What is 2+2?" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION]).toBe(
        "You are a math tutor",
      );
    });

    it("does not overwrite existing model name", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "existing-model",
        },
        mastraScope,
      );

      extractor.apply(ctx);

      // Should not overwrite — existing model stays in bag
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBeUndefined();
    });

    it("sets display name with model for model_step", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("LLM Step: grok-3-mini");
    });

    it("sets display name with model for model_generation", () => {
      const input = JSON.stringify({
        body: {
          model: "claude-3-haiku",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_generation",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("LLM: claude-3-haiku");
    });
  });

  describe("when model_step has modelMetadata in metadata", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("uses modelMetadata.modelId as fallback for model name", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          "mastra.metadata.modelMetadata": JSON.stringify({
            modelId: "gpt-4o",
            modelVersion: "2024-08-06",
            modelProvider: "openai",
          }),
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("gpt-4o");
      expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_MODEL]).toBe("gpt-4o");
    });

    it("prefers body.model over modelMetadata", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
          "mastra.metadata.modelMetadata": JSON.stringify({
            modelId: "gpt-4o",
          }),
        },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("grok-3-mini");
    });
  });

  describe("when model_step is an eval (orphan or has response_format)", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("maps to evaluation type instead of llm", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step" },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("evaluation");
    });

    it("extracts system prompt as langwatch.input", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "system", content: "Score the translation quality from 0-10" },
            { role: "user", content: "Original: Hello. Translation: Bonjour." },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe(
        "Score the translation quality from 0-10",
      );
    });

    it("extracts structured object output as langwatch.output", () => {
      const output = JSON.stringify({
        object: { score: 9, reason: "Accurate translation" },
        text: "",
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe(
        JSON.stringify({ score: 9, reason: "Accurate translation" }),
      );
    });

    it("falls back to text when no object output", () => {
      const output = JSON.stringify({
        text: "Score: 8/10",
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT]: output,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe("Score: 8/10");
    });

    it("sets display name as Eval with system prompt excerpt", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "system", content: "Score the translation quality" },
            { role: "user", content: "test" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("Eval: Score the translation quality");
    });

    it("truncates long system prompt in display name", () => {
      const longPrompt = "A".repeat(100);
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [
            { role: "system", content: longPrompt },
            { role: "user", content: "test" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe(`Eval: ${"A".repeat(57)}...`);
    });

    it("falls back to model name in display name when no system prompt", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "test" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("Eval: grok-3-mini");
    });

    it("uses bare Eval when no model or system prompt available", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step" },
        { ...mastraScope, parentSpanId: null },
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("Eval");
    });

    it("detects eval model_step with parent when response_format present", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          response_format: { type: "json_schema", json_schema: { name: "response" } },
          messages: [
            { role: "system", content: "You are an expert evaluator" },
            { role: "user", content: "Evaluate this" },
          ],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: "parent-agent-run" },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("evaluation");
    });

    it("does not mark model_step with parent and no response_format as evaluation", () => {
      const input = JSON.stringify({
        body: {
          model: "grok-3-mini",
          messages: [{ role: "user", content: "hi" }],
        },
      });
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step",
          [ATTR_KEYS.MASTRA_MODEL_STEP_INPUT]: input,
        },
        { ...mastraScope, parentSpanId: "parent-123" },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when display name override applies", () => {
    const mastraScope = {
      instrumentationScope: { name: "@mastra/otel", version: null },
    };

    it("does not set display name for agent_run", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "agent_run" },
        { ...mastraScope, name: "invoke_agent Weather Agent" },
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("invoke_agent Weather Agent");
    });

    it("does not set display name for model_step without model", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_step" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("test");
    });

    it("does not set display name for model_chunk", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.MASTRA_SPAN_TYPE]: "model_chunk" },
        mastraScope,
      );

      extractor.apply(ctx);

      expect(ctx.span.name).toBe("test");
    });
  });
});
