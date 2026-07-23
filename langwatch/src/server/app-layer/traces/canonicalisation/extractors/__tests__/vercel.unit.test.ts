import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { VercelExtractor } from "../vercel";
import { createExtractorContext } from "./_testHelpers";

describe("VercelExtractor", () => {
  const extractor = new VercelExtractor();

  describe("when instrumentationScope.name is 'ai'", () => {
    it("processes the span and sets span type from span name", () => {
      const ctx = createExtractorContext(
        {},
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
      expect(ctx.setAttr).toHaveBeenCalled();
    });

    it("records a rule for span type mapping", () => {
      const ctx = createExtractorContext(
        {},
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.recordRule).toHaveBeenCalledWith(
        "vercel:span.name->langwatch.span.type",
      );
    });

    it("sets model attributes when ai.model is provided", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
      expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when ai.response contains .object (generateObject / streamObject)", () => {
    const aiSpan = {
      name: "ai.generateObject" as const,
      instrumentationScope: { name: "ai" as const, version: null },
    };

    it("extracts ai.response.object as output messages", () => {
      const objectPayload = { name: "Alice", age: 30 };
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE]: JSON.stringify({
            object: JSON.stringify(objectPayload),
          }),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: JSON.stringify(objectPayload) },
      ]);
    });

    it("extracts ai.response.object as flat attribute fallback", () => {
      const objectPayload = { name: "Bob", score: 42 };
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE_OBJECT]: JSON.stringify(objectPayload),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: JSON.stringify(objectPayload) },
      ]);
    });

    it("prefers .text over .object when both are present", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE]: JSON.stringify({
            text: "hello",
            object: JSON.stringify({ key: "val" }),
          }),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: "hello" },
      ]);
    });
  });

  describe("when instrumentationScope.name is not 'ai' but ai.* attrs are present", () => {
    it("still lifts (covers opencode/embedded-Vercel-SDK case)", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      // Span type + model lift fire because ai.model attr triggers the gate
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when scope is unrelated AND no ai.* attrs are present", () => {
    it("returns early with nothing in out", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "claude-haiku-4-5",
        },
        {
          name: "spanWithoutAiAttrs",
          instrumentationScope: { name: "opentelemetry", version: null },
        },
      );

      extractor.apply(ctx);

      expect(Object.keys(ctx.out)).toHaveLength(0);
      expect(ctx.setAttr).not.toHaveBeenCalled();
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });
  });

  describe("when instrumentationScope.name is undefined but ai.* attrs are present", () => {
    it("still lifts via attrs-presence fallback", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: {
            name: undefined as unknown as string,
            version: null,
          },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when the AI SDK reports cache token details", () => {
    /** @scenario "A cached turn's input is split into fresh and cached buckets" */
    it("maps inputTokenDetails.cacheWriteTokens to gen_ai cache_creation (opencode Path B)", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          "gen_ai.usage.input_tokens": 13000,
          [ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS]: 12629,
          [ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS]: 0,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(
        12629,
      );
      // a zero read count is not surfaced as a redundant gen_ai attr
      expect(
        ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
      ).toBeUndefined();
      // the canonical input is rewritten to the fresh remainder so the
      // cache-write bucket adds on top instead of being counted twice
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(371);
    });

    it("maps inputTokenDetails.cacheReadTokens to gen_ai cache_read on a cached turn", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          "gen_ai.usage.input_tokens": 13000,
          [ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS]: 12629,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(
        12629,
      );
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(371);
    });

    it("falls back to the cachedInputTokens alias for the read count", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          "gen_ai.usage.input_tokens": 9000,
          [ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS]: 8745,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(
        8745,
      );
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(255);
    });

    /** @scenario "The SDK's own fresh-input count is trusted when reported" */
    it("prefers the SDK's own noCacheTokens for the fresh input remainder", () => {
      const ctx = createExtractorContext(
        {
          "gen_ai.usage.input_tokens": 25449,
          [ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS]: 20000,
          [ATTR_KEYS.AI_USAGE_NO_CACHE_TOKENS]: 5449,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(
        20000,
      );
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(5449);
    });

    /** @scenario "The cached split is counted once per LLM call" */
    it("skips the mapping on the parent rollup span with no canonical input", () => {
      // ai.streamText (the parent) repeats the same ai.usage.* rollup as
      // the provider-call child but carries no gen_ai.usage.input_tokens;
      // mapping cache onto it would count the cached share twice in the
      // trace fold.
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_USAGE_INPUT_TOKENS]: 25449,
          [ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS]: 20000,
          [ATTR_KEYS.AI_USAGE_NO_CACHE_TOKENS]: 5449,
        },
        {
          name: "ai.streamText",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(
        ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
      ).toBeUndefined();
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBeUndefined();
    });

    /** @scenario "Reasoning tokens reported by the SDK reach the trace" */
    it("maps the flat reasoningTokens count to gen_ai reasoning_tokens", () => {
      const ctx = createExtractorContext(
        {
          "gen_ai.usage.input_tokens": 9000,
          [ATTR_KEYS.AI_USAGE_INPUT_TOKENS]: 9000,
          [ATTR_KEYS.AI_USAGE_REASONING_TOKENS]: 384,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]).toBe(384);
    });
  });

  describe("when the span is an ai.toolCall tool span under the opencode scope", () => {
    /** @scenario "Opencode tool-call spans capture the tool name, arguments, and result" */
    it("lifts ai.toolCall.{name,args,result} to the tool name + input/output", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_TOOL_CALL_NAME]: "bash",
          [ATTR_KEYS.AI_TOOL_CALL_ARGS]: '{"command":"ls -la"}',
          [ATTR_KEYS.AI_TOOL_CALL_RESULT]: "total 4\ndrwxr-xr-x",
        },
        {
          name: "ai.toolCall",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
      expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_NAME]).toBe("bash");
      expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe('{"command":"ls -la"}');
      expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS]).toBe(
        '{"command":"ls -la"}',
      );
      expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe("total 4\ndrwxr-xr-x");
      expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT]).toBe(
        "total 4\ndrwxr-xr-x",
      );
    });

    it("detects the tool span even though the scope is not 'ai'", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.AI_TOOL_CALL_NAME]: "read_file" },
        {
          name: "ai.toolCall",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_NAME]).toBe("read_file");
    });
  });
});
