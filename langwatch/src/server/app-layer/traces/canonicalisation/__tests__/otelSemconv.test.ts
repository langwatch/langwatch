/**
 * OTel GenAI Semantic Conventions v1.38.0 Conformance Tests
 *
 * Verifies that spans conforming to the OTel GenAI semantic conventions
 * (https://github.com/open-telemetry/semantic-conventions/tree/v1.38.0/docs/gen-ai)
 * are parsed correctly by the canonicalisation pipeline.
 *
 * These tests use the full CanonicalizeSpanAttributesService to catch
 * interaction bugs between extractors.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const clientSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "chat gpt-4",
  kind: "CLIENT",
  instrumentationScope: { name: "openai.sdk", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

const internalSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "execute_tool search",
  kind: "INTERNAL",
  instrumentationScope: { name: "my-agent", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

describe("OTel GenAI Semantic Conventions v1.38.0", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Core attributes
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with core attributes", () => {
    it("preserves gen_ai.operation.name, provider, model, and response metadata", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.response.model": "gpt-4-0613",
          "gen_ai.response.id": "chatcmpl-123",
          "gen_ai.response.finish_reasons": ["stop"],
          "gen_ai.conversation.id": "conv_abc",
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.operation.name"]).toBe("chat");
      expect(result.attributes["gen_ai.provider.name"]).toBe("openai");
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-4");
      expect(result.attributes["gen_ai.response.model"]).toBe("gpt-4-0613");
      expect(result.attributes["gen_ai.response.id"]).toBe("chatcmpl-123");
      expect(result.attributes["gen_ai.response.finish_reasons"]).toEqual([
        "stop",
      ]);
      expect(result.attributes["gen_ai.conversation.id"]).toBe("conv_abc");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Request parameters
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with request parameters", () => {
    it("preserves temperature, max_tokens, top_p, penalties, seed, stop_sequences", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.request.temperature": 0.7,
          "gen_ai.request.max_tokens": 1000,
          "gen_ai.request.top_p": 0.9,
          "gen_ai.request.frequency_penalty": 0.5,
          "gen_ai.request.presence_penalty": 0.3,
          "gen_ai.request.seed": 42,
          "gen_ai.request.stop_sequences": ["END", "STOP"],
          "gen_ai.request.choice.count": 3,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.request.temperature"]).toBe(0.7);
      expect(result.attributes["gen_ai.request.max_tokens"]).toBe(1000);
      expect(result.attributes["gen_ai.request.top_p"]).toBe(0.9);
      expect(result.attributes["gen_ai.request.frequency_penalty"]).toBe(0.5);
      expect(result.attributes["gen_ai.request.presence_penalty"]).toBe(0.3);
      expect(result.attributes["gen_ai.request.seed"]).toBe(42);
      expect(result.attributes["gen_ai.request.stop_sequences"]).toEqual([
        "END",
        "STOP",
      ]);
      expect(result.attributes["gen_ai.request.choice.count"]).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Usage tokens
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with usage tokens", () => {
    it("preserves gen_ai.usage.input_tokens and output_tokens", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.usage.input_tokens": 150,
          "gen_ai.usage.output_tokens": 280,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(150);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(280);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Input messages (parts-based format, v1.38.0)
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with parts-based input messages", () => {
    it("preserves text parts in gen_ai.input.messages", () => {
      const inputMessages = [
        {
          role: "system",
          parts: [{ type: "text", content: "You are a helpful assistant." }],
        },
        {
          role: "user",
          parts: [{ type: "text", content: "What is the capital of France?" }],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.input.messages": inputMessages,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);
    });

    it("preserves tool_call parts in assistant messages", () => {
      const inputMessages = [
        {
          role: "user",
          parts: [{ type: "text", content: "Search for flights" }],
        },
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              name: "search_flights",
              id: "call_123",
              arguments: { destination: "Paris" },
            },
          ],
        },
        {
          role: "tool",
          parts: [
            {
              type: "tool_call_response",
              id: "call_123",
              response: '{"flights": []}',
            },
          ],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.input.messages": inputMessages,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);
    });

    it("extracts system instruction from parts-based system message", () => {
      const inputMessages = [
        {
          role: "system",
          parts: [{ type: "text", content: "Be concise." }],
        },
        {
          role: "user",
          parts: [{ type: "text", content: "Hi" }],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.input.messages": inputMessages,
        },
        [],
        clientSpan as any,
      );

      // The GenAI extractor tries to extract system instruction from existing messages
      // Parts-based content uses {type: "text", content: "..."} which the helper handles
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "Be concise.",
      );
    });

    it("preserves multimodal blob parts", () => {
      const inputMessages = [
        {
          role: "user",
          parts: [
            { type: "text", content: "Describe this image" },
            {
              type: "blob",
              modality: "image",
              content: "base64encodeddata==",
              mime_type: "image/png",
            },
          ],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4-vision",
          "gen_ai.input.messages": inputMessages,
        },
        [],
        clientSpan as any,
      );

      const parsed = result.attributes["gen_ai.input.messages"] as any[];
      expect(parsed[0].parts).toHaveLength(2);
      expect(parsed[0].parts[1].type).toBe("blob");
      expect(parsed[0].parts[1].modality).toBe("image");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Output messages (parts-based format, v1.38.0)
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with parts-based output messages", () => {
    it("preserves text output with finish_reason", () => {
      const outputMessages = [
        {
          role: "assistant",
          parts: [{ type: "text", content: "Paris is the capital of France." }],
          finish_reason: "stop",
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.messages": outputMessages,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.output.messages"]).toEqual(outputMessages);
    });

    it("preserves tool_call output messages", () => {
      const outputMessages = [
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              name: "get_weather",
              id: "call_456",
              arguments: { city: "Paris" },
            },
          ],
          finish_reason: "tool_call",
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.messages": outputMessages,
        },
        [],
        clientSpan as any,
      );

      const parsed = result.attributes["gen_ai.output.messages"] as any[];
      expect(parsed[0].parts[0].type).toBe("tool_call");
      expect(parsed[0].finish_reason).toBe("tool_call");
    });

    it("preserves multiple output choices", () => {
      const outputMessages = [
        {
          role: "assistant",
          parts: [{ type: "text", content: "Choice 1" }],
          finish_reason: "stop",
        },
        {
          role: "assistant",
          parts: [{ type: "text", content: "Choice 2" }],
          finish_reason: "stop",
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.messages": outputMessages,
          "gen_ai.request.choice.count": 2,
        },
        [],
        clientSpan as any,
      );

      const parsed = result.attributes["gen_ai.output.messages"] as any[];
      expect(parsed).toHaveLength(2);
    });

    it("preserves reasoning parts in output", () => {
      const outputMessages = [
        {
          role: "assistant",
          parts: [
            { type: "reasoning", content: "Let me think about this..." },
            { type: "text", content: "The answer is 42." },
          ],
          finish_reason: "stop",
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "o1",
          "gen_ai.output.messages": outputMessages,
        },
        [],
        clientSpan as any,
      );

      const parsed = result.attributes["gen_ai.output.messages"] as any[];
      expect(parsed[0].parts[0].type).toBe("reasoning");
      expect(parsed[0].parts[1].type).toBe("text");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — System instructions (v1.38.0)
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with gen_ai.system_instructions", () => {
    it("preserves system_instructions attribute", () => {
      const instructions = [
        { type: "text", content: "You are a helpful assistant." },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.system_instructions": instructions,
        },
        [],
        clientSpan as any,
      );

      // system_instructions is not consumed by any extractor, so it passes through
      expect(result.attributes["gen_ai.system_instructions"]).toEqual(instructions);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inference Span — Tool definitions
  // ─────────────────────────────────────────────────────────────────────────
  describe("inference span with tool definitions", () => {
    it("preserves gen_ai.tool.definitions", () => {
      const toolDefs = [
        {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.tool.definitions": toolDefs,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.tool.definitions"]).toEqual(toolDefs);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Execute Tool Span
  // ─────────────────────────────────────────────────────────────────────────
  describe("execute_tool span", () => {
    it("preserves tool span attributes", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "search_flights",
          "gen_ai.tool.call.id": "call_abc123",
          "gen_ai.tool.description": "Search available flights",
          "gen_ai.tool.type": "function",
          "gen_ai.tool.call.arguments": {
            destination: "Paris",
          },
          "gen_ai.tool.call.result": { flights: [] },
        },
        [],
        internalSpan as any,
      );

      expect(result.attributes["gen_ai.operation.name"]).toBe("execute_tool");
      expect(result.attributes["gen_ai.tool.name"]).toBe("search_flights");
      expect(result.attributes["gen_ai.tool.call.id"]).toBe("call_abc123");
      expect(result.attributes["gen_ai.tool.description"]).toBe(
        "Search available flights",
      );
      expect(result.attributes["gen_ai.tool.type"]).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Embeddings Span
  // ─────────────────────────────────────────────────────────────────────────
  describe("embeddings span", () => {
    it("preserves embeddings-specific attributes", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "embeddings",
          "gen_ai.request.model": "text-embedding-3-small",
          "gen_ai.usage.input_tokens": 50,
          "gen_ai.embeddings.dimension.count": 1536,
          "gen_ai.request.encoding_formats": ["float"],
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.operation.name"]).toBe("embeddings");
      expect(result.attributes["gen_ai.request.model"]).toBe(
        "text-embedding-3-small",
      );
      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(50);
      expect(result.attributes["gen_ai.embeddings.dimension.count"]).toBe(1536);
      expect(result.attributes["gen_ai.request.encoding_formats"]).toEqual([
        "float",
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────────────────────────────────
  describe("when error.type is set on a gen_ai span", () => {
    it("preserves error.type alongside gen_ai attributes", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "error.type": "rate_limit_exceeded",
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["error.type"]).toBe("rate_limit_exceeded");
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-4");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Full realistic inference span (integration-level)
  // ─────────────────────────────────────────────────────────────────────────
  describe("full realistic inference span", () => {
    it("handles a complete OpenAI-style chat span with all attributes", () => {
      const inputMessages = [
        {
          role: "system",
          parts: [{ type: "text", content: "You are a helpful assistant." }],
        },
        {
          role: "user",
          parts: [
            { type: "text", content: "What is the weather in Paris?" },
          ],
        },
      ];

      const outputMessages = [
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              name: "get_weather",
              id: "call_xyz",
              arguments: { city: "Paris" },
            },
          ],
          finish_reason: "tool_call",
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.response.model": "gpt-4-0613",
          "gen_ai.response.id": "chatcmpl-abc",
          "gen_ai.response.finish_reasons": ["tool_call"],
          "gen_ai.request.temperature": 0.0,
          "gen_ai.request.max_tokens": 4096,
          "gen_ai.usage.input_tokens": 45,
          "gen_ai.usage.output_tokens": 22,
          "gen_ai.input.messages": inputMessages,
          "gen_ai.output.messages": outputMessages,
          "gen_ai.tool.definitions": [
            {
              name: "get_weather",
              description: "Get weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
              },
            },
          ],
          "gen_ai.conversation.id": "conv_session_1",
        },
        [],
        clientSpan as any,
      );

      // Core attributes
      expect(result.attributes["gen_ai.operation.name"]).toBe("chat");
      expect(result.attributes["gen_ai.provider.name"]).toBe("openai");
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-4");
      expect(result.attributes["gen_ai.response.model"]).toBe("gpt-4-0613");
      expect(result.attributes["gen_ai.response.id"]).toBe("chatcmpl-abc");

      // Request params
      expect(result.attributes["gen_ai.request.temperature"]).toBe(0.0);
      expect(result.attributes["gen_ai.request.max_tokens"]).toBe(4096);

      // Usage
      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(45);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(22);

      // Messages preserved as-is
      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);
      expect(result.attributes["gen_ai.output.messages"]).toEqual(outputMessages);

      // System instruction extracted from parts-based message
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "You are a helpful assistant.",
      );

      // Conversation ID
      expect(result.attributes["gen_ai.conversation.id"]).toBe(
        "conv_session_1",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy content format (pre-v1.38.0 — string content, no parts)
  // ─────────────────────────────────────────────────────────────────────────
  describe("legacy content format (pre-v1.38.0, no parts wrapper)", () => {
    it("handles input messages with direct string content", () => {
      const inputMessages = [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.input.messages": inputMessages,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);

      // System instruction extraction from direct string content
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "Be concise.",
      );
    });

    it("handles output messages with direct string content", () => {
      const outputMessages = [
        { role: "assistant", content: "The capital of France is Paris." },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.messages": outputMessages,
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.output.messages"]).toEqual(outputMessages);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Agent span (v1.38.0)
  // ─────────────────────────────────────────────────────────────────────────
  describe("agent span", () => {
    it("preserves agent-related attributes", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.name": "travel-planner",
          "gen_ai.agent.id": "agent_123",
          "gen_ai.agent.description": "Plans travel itineraries",
        },
        [],
        internalSpan as any,
      );

      expect(result.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
      expect(result.attributes["gen_ai.agent.name"]).toBe("travel-planner");
      expect(result.attributes["gen_ai.agent.id"]).toBe("agent_123");
      expect(result.attributes["gen_ai.agent.description"]).toBe(
        "Plans travel itineraries",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // gen_ai.output.type (v1.38.0)
  // ─────────────────────────────────────────────────────────────────────────
  describe("when gen_ai.output.type is set", () => {
    it("preserves text output type", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.type": "text",
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.output.type"]).toBe("text");
    });

    it("preserves json output type", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-4",
          "gen_ai.output.type": "json",
        },
        [],
        clientSpan as any,
      );

      expect(result.attributes["gen_ai.output.type"]).toBe("json");
    });
  });
});
