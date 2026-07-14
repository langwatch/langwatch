import { describe, expect, it, vi } from "vitest";

import type { NormalizedAttributes } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import { ATTR_KEYS } from "../_constants";
import type { ExtractorContext } from "../_types";
import { VertexAdkExtractor } from "../vertexAdk";
import { createExtractorContext } from "./_testHelpers";

/**
 * Anonymised replicas of real Google ADK / Vertex AI Agent Engine span
 * payloads (agent names, ids, prompts, and tool schemas replaced with
 * synthetic equivalents; structure preserved verbatim).
 */

const SYSTEM_INSTRUCTION =
  "You are TravelPlanner, a travel planning assistant. Keep answers short.";

const llmRequestPayload = {
  model: "gemini-2.5-pro",
  config: {
    system_instruction: SYSTEM_INSTRUCTION,
    tools: [
      {
        function_declarations: [
          {
            description: "Look up the current weather for a city.",
            name: "lookup_weather",
            parameters: {
              properties: { city: { type: "STRING" } },
              required: ["city"],
              type: "OBJECT",
            },
          },
        ],
      },
    ],
  },
  contents: [
    {
      parts: [{ text: "What's the weather like in Amsterdam today?" }],
      role: "user",
    },
    {
      parts: [
        {
          function_call: {
            id: "tool-call-0001",
            args: { city: "Amsterdam" },
            name: "lookup_weather",
          },
        },
      ],
      role: "model",
    },
    {
      parts: [
        {
          function_response: {
            id: "tool-call-0001",
            name: "lookup_weather",
            response: { temperature: "18C", condition: "cloudy" },
          },
        },
      ],
      role: "user",
    },
  ],
};

const llmResponsePayload = {
  content: {
    parts: [
      { text: "I'll check the forecast before suggesting an itinerary." },
      {
        function_call: {
          id: "tool-call-0002",
          args: { city: "Amsterdam", days: 3 },
          name: "lookup_forecast",
        },
      },
    ],
    role: "model",
  },
  partial: false,
  usage_metadata: {
    cached_content_token_count: 2100,
    candidates_token_count: 64,
    prompt_token_count: 2500,
    total_token_count: 2564,
  },
};

/** Standard gen_ai.* attributes as emitted by ADK on a generate_content span */
const llmSpanBaseAttrs = {
  "gen_ai.operation.name": "generate_content",
  "gen_ai.conversation.id": "session-1234abcd",
  "gen_ai.request.model": "gemini-2.5-pro",
  "gen_ai.provider.name": "gcp.vertex.agent",
  "gen_ai.agent.name": "TravelPlanner",
  "gcp.vertex.agent.invocation_id": "e-11111111-2222-3333-4444-555555555555",
  "gcp.vertex.agent.session_id": "session-1234abcd",
  "gcp.vertex.agent.event_id": "66666666-7777-8888-9999-000000000000",
};

const llmSpanAttrs = (): Record<string, unknown> => ({
  ...llmSpanBaseAttrs,
  "gen_ai.usage.input_tokens": 2500,
  "gen_ai.usage.output_tokens": 64,
  "gcp.vertex.agent.llm_request": JSON.stringify(llmRequestPayload),
  "gcp.vertex.agent.llm_response": JSON.stringify(llmResponsePayload),
});

const toolSpanAttrs = (): Record<string, unknown> => ({
  "gen_ai.operation.name": "execute_tool",
  "gen_ai.tool.name": "lookup_weather",
  "gen_ai.tool.description": "Look up the current weather for a city.",
  "gen_ai.tool.type": "FunctionTool",
  "gen_ai.tool.call.id": "tool-call-0001",
  "gcp.vertex.agent.event_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "gcp.vertex.agent.llm_request": "{}",
  "gcp.vertex.agent.llm_response": "{}",
  "gcp.vertex.agent.tool_call_args": JSON.stringify({ city: "Amsterdam" }),
  "gcp.vertex.agent.tool_response": JSON.stringify({
    temperature: "18C",
    condition: "cloudy",
  }),
});

describe("VertexAdkExtractor", () => {
  const extractor = new VertexAdkExtractor();

  describe("given a generate_content span", () => {
    describe("when the span is canonicalised", () => {
      it("extracts the conversation as gen_ai.input.messages", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
          {
            role: "user",
            content: "What's the weather like in Amsterdam today?",
          },
          {
            role: "assistant",
            tool_calls: [
              {
                id: "tool-call-0001",
                type: "function",
                function: {
                  name: "lookup_weather",
                  arguments: JSON.stringify({ city: "Amsterdam" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "tool-call-0001",
            name: "lookup_weather",
            content: JSON.stringify({
              temperature: "18C",
              condition: "cloudy",
            }),
          },
        ]);
      });

      it("extracts the model reply as gen_ai.output.messages", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
          {
            role: "assistant",
            content: "I'll check the forecast before suggesting an itinerary.",
            tool_calls: [
              {
                id: "tool-call-0002",
                type: "function",
                function: {
                  name: "lookup_forecast",
                  arguments: JSON.stringify({ city: "Amsterdam", days: 3 }),
                },
              },
            ],
          },
        ]);
      });

      it("surfaces the system instruction separately from the chat messages", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS]).toBe(
          SYSTEM_INSTRUCTION,
        );
        const input = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] as unknown[];
        for (const message of input) {
          expect((message as { role: string }).role).not.toBe("system");
        }
      });

      it("annotates input and output messages as chat_messages", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES]).toEqual([
          `${ATTR_KEYS.GEN_AI_INPUT_MESSAGES}=chat_messages`,
          `${ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES}=chat_messages`,
        ]);
      });

      it("lifts tool declarations to gen_ai.tool.definitions", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS]).toEqual(
          llmRequestPayload.config.tools,
        );
      });

      it("types the span as llm", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
      });

      it("consumes the vendor request/response payload attributes", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.bag.attrs.has("gcp.vertex.agent.llm_request")).toBe(false);
        expect(ctx.bag.attrs.has("gcp.vertex.agent.llm_response")).toBe(false);
      });

      it("keeps the vendor session/invocation ids as passthrough attributes", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.bag.attrs.has("gcp.vertex.agent.session_id")).toBe(true);
        expect(ctx.bag.attrs.has("gcp.vertex.agent.invocation_id")).toBe(true);
      });
    });

    describe("when the span already reports standard token usage", () => {
      it("keeps the explicitly reported token counts", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBeUndefined();
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBeUndefined();
        expect(ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS)).toBe(
          2500,
        );
      });

      it("still lifts cached prompt tokens as cache-read tokens", () => {
        const ctx = createExtractorContext(llmSpanAttrs());

        extractor.apply(ctx);

        expect(
          ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
        ).toBe(2100);
      });
    });

    describe("when the span reports no standard token usage", () => {
      it("falls back to the response usage metadata", () => {
        const attrs = llmSpanAttrs();
        delete attrs["gen_ai.usage.input_tokens"];
        delete attrs["gen_ai.usage.output_tokens"];
        const ctx = createExtractorContext(attrs);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(2500);
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(64);
      });
    });

    describe("when gen_ai.input.messages is already present", () => {
      it("does not overwrite the existing messages", () => {
        const existing = [{ role: "user", content: "already extracted" }];
        const ctx = createExtractorContext({
          ...llmSpanAttrs(),
          [ATTR_KEYS.GEN_AI_INPUT_MESSAGES]: existing,
        });

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
        expect(ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)).toEqual(
          existing,
        );
      });
    });

    describe("when the response carries raw Gemini candidates", () => {
      it("extracts output messages from candidates[].content", () => {
        const attrs = llmSpanAttrs();
        attrs["gcp.vertex.agent.llm_response"] = JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Pack an umbrella." }],
                role: "model",
              },
            },
          ],
        });
        const ctx = createExtractorContext(attrs);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
          { role: "assistant", content: "Pack an umbrella." },
        ]);
      });
    });

    describe("when the system instruction is a content object", () => {
      it("joins the text parts", () => {
        const attrs = llmSpanAttrs();
        attrs["gcp.vertex.agent.llm_request"] = JSON.stringify({
          model: "gemini-2.5-pro",
          config: {
            system_instruction: {
              parts: [{ text: "Be concise." }, { text: "Be kind." }],
            },
          },
          contents: [{ parts: [{ text: "hi" }], role: "user" }],
        });
        const ctx = createExtractorContext(attrs);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS]).toBe(
          "Be concise.\nBe kind.",
        );
      });
    });

    describe("when generation config parameters are present", () => {
      it("lifts them to gen_ai.request.* parameters", () => {
        const attrs = llmSpanAttrs();
        attrs["gcp.vertex.agent.llm_request"] = JSON.stringify({
          model: "gemini-2.5-pro",
          config: {
            temperature: 0.2,
            top_p: 0.9,
            top_k: 40,
            max_output_tokens: 1024,
          },
          contents: [{ parts: [{ text: "hi" }], role: "user" }],
        });
        const ctx = createExtractorContext(attrs);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE]).toBe(0.2);
        expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_TOP_P]).toBe(0.9);
        expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_TOP_K]).toBe(40);
        expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS]).toBe(1024);
      });
    });
  });

  describe("given an execute_tool span", () => {
    describe("when the span is canonicalised", () => {
      it("types the span as tool", () => {
        const ctx = createExtractorContext(toolSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
      });

      it("lifts the call arguments to langwatch.input and gen_ai.tool.call.arguments", () => {
        const ctx = createExtractorContext(toolSpanAttrs());

        extractor.apply(ctx);

        const expected = JSON.stringify({ city: "Amsterdam" });
        expect(ctx.out[ATTR_KEYS.LANGWATCH_INPUT]).toBe(expected);
        expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS]).toBe(expected);
      });

      it("lifts the tool response to langwatch.output and gen_ai.tool.call.result", () => {
        const ctx = createExtractorContext(toolSpanAttrs());

        extractor.apply(ctx);

        const expected = JSON.stringify({
          temperature: "18C",
          condition: "cloudy",
        });
        expect(ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT]).toBe(expected);
        expect(ctx.out[ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT]).toBe(expected);
      });

      it("does not produce chat messages from the empty request/response payloads", () => {
        const ctx = createExtractorContext(toolSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
        expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
      });

      it("consumes the vendor tool payload attributes", () => {
        const ctx = createExtractorContext(toolSpanAttrs());

        extractor.apply(ctx);

        expect(ctx.bag.attrs.has("gcp.vertex.agent.tool_call_args")).toBe(
          false,
        );
        expect(ctx.bag.attrs.has("gcp.vertex.agent.tool_response")).toBe(
          false,
        );
        expect(ctx.bag.attrs.has("gcp.vertex.agent.llm_request")).toBe(false);
        expect(ctx.bag.attrs.has("gcp.vertex.agent.llm_response")).toBe(false);
      });
    });

    describe("when the span type is explicitly set", () => {
      it("respects the explicit type", () => {
        const ctx = createExtractorContext({
          ...toolSpanAttrs(),
          [ATTR_KEYS.SPAN_TYPE]: "component",
        });

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
      });
    });
  });

  describe("given an invoke_agent span", () => {
    describe("when the span is canonicalised", () => {
      it("types the span as agent", () => {
        const ctx = createExtractorContext({
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.provider.name": "gcp.vertex.agent",
          "gen_ai.agent.name": "TravelPlanner",
        });

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("agent");
      });
    });
  });

  describe("given a span missing gen_ai.conversation.id", () => {
    describe("when the vendor session id is present", () => {
      it("falls back to gcp.vertex.agent.session_id", () => {
        const attrs = llmSpanAttrs();
        delete attrs["gen_ai.conversation.id"];
        const ctx = createExtractorContext(attrs);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe(
          "session-1234abcd",
        );
      });
    });
  });

  describe("given the payload arrives as a JSON string that bypassed pre-parsing", () => {
    it("parses the request payload itself", () => {
      const ctx = createRawContext({
        "gen_ai.provider.name": "gcp.vertex.agent",
        "gcp.vertex.agent.llm_request": JSON.stringify({
          model: "gemini-2.5-pro",
          contents: [{ parts: [{ text: "hello" }], role: "user" }],
        }),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
        { role: "user", content: "hello" },
      ]);
    });
  });

  describe("given a span from a different SDK", () => {
    describe("when the span is canonicalised", () => {
      it("does nothing", () => {
        const ctx = createExtractorContext({
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-5-mini",
        });

        extractor.apply(ctx);

        expect(ctx.out).toEqual({});
        expect(ctx.recordRule).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * Builds a context WITHOUT the helper's automatic JSON-string parsing, so
 * the extractor's own defensive safeJsonParse path is exercised.
 */
function createRawContext(raw: Record<string, unknown>): ExtractorContext {
  const bag = new SpanDataBag(raw as NormalizedAttributes, []);
  const out: NormalizedAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value;
  });
  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (!(key in out)) {
      if (value === null || value === undefined) return;
      out[key] = value;
    }
  });

  return {
    bag,
    out,
    span: {
      name: "test",
      kind: 0,
      instrumentationScope: { name: "test", version: null },
      statusMessage: null,
      statusCode: null,
      parentSpanId: "abc123",
    },
    recordRule: vi.fn(),
    setAttr,
    setAttrIfAbsent,
  };
}
