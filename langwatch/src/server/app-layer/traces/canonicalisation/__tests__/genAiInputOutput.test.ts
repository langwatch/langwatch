import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

/** Minimal span context for canonicalize() */
const stubSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope"
> = {
  name: "chat claude-opus-4-6",
  kind: "CLIENT",
  instrumentationScope: { name: "openclaw", version: "1.0.0" },
} as any;

describe("CanonicalizeSpanAttributesService", () => {
  describe("when span has gen_ai.input.messages and gen_ai.output.messages", () => {
    it("preserves Anthropic-style content blocks without stripping", () => {
      const inputMessages = [
        {
          role: "user",
          content: [{ type: "text", text: "What is the weather?" }],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "tool_use",
              id: "tool_abc",
              name: "get_weather",
              input: { location: "London" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_abc",
              content: "Sunny, 22°C",
            },
          ],
        },
      ];

      const outputMessages = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "It's sunny at 22°C in London." },
          ],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "claude-opus-4-6",
          "gen_ai.provider.name": "anthropic",
          "gen_ai.input.messages": inputMessages,
          "gen_ai.output.messages": outputMessages,
          "gen_ai.usage.input_tokens": 150,
          "gen_ai.usage.output_tokens": 25,
        },
        [],
        stubSpan as any,
      );

      // gen_ai.input.messages must survive as-is
      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);

      // gen_ai.output.messages must survive as-is
      expect(result.attributes["gen_ai.output.messages"]).toEqual(outputMessages);

      // Model and usage should be extracted correctly
      expect(result.attributes["gen_ai.request.model"]).toBe("claude-opus-4-6");
      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(150);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(25);
    });

    it("preserves messages with 'parts' pattern (Vercel AI SDK / pi-ai style)", () => {
      const inputMessages = [
        {
          role: "system",
          content: [{ type: "text", content: "You are Snaps the lobster." }],
        },
        {
          role: "user",
          parts: [{ type: "text", content: "[Sun 2026-02-08 20:58 UTC] hi" }],
        },
      ];

      const outputMessages = [
        {
          role: "assistant",
          parts: [{ type: "text", content: "Hey Rogerio! What's up?" }],
        },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "claude-opus-4-6",
          "gen_ai.input.messages": inputMessages,
          "gen_ai.output.messages": outputMessages,
        },
        [],
        stubSpan as any,
      );

      // System messages stripped; only non-system messages preserved
      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        {
          role: "user",
          parts: [{ type: "text", content: "[Sun 2026-02-08 20:58 UTC] hi" }],
        },
      ]);
      expect(result.attributes["gen_ai.output.messages"]).toEqual(outputMessages);

      // System instruction extracted from content blocks using 'content' field
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "You are Snaps the lobster.",
      );
    });

    it("infers type 'tool' when gen_ai.operation.name is 'tool'", () => {
      const result = service.canonicalize(
        {
          "gen_ai.operation.name": "tool",
          "gen_ai.tool.name": "get_weather",
          "gen_ai.tool.call.id": "call_abc123",
        },
        [],
        {
          ...stubSpan,
          name: "get_weather",
        } as any,
      );

      expect(result.attributes["langwatch.span.type"]).toBe("tool");
    });

    it("does not overwrite existing gen_ai.input.messages with legacy fallback", () => {
      const inputMessages = [
        { role: "user", content: "Hello" },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.input.messages": inputMessages,
          // Legacy key that should NOT overwrite gen_ai.input.messages
          "gen_ai.prompt": JSON.stringify([
            { role: "user", content: "Legacy prompt" },
          ]),
        },
        [],
        stubSpan as any,
      );

      // gen_ai.input.messages wins over gen_ai.prompt
      expect(result.attributes["gen_ai.input.messages"]).toEqual(inputMessages);
    });
  });
});
