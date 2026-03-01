import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const stubSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "test",
  kind: "CLIENT",
  instrumentationScope: { name: "test", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

/** Vercel AI SDK spans require instrumentationScope.name === "ai" */
const vercelSpan: typeof stubSpan = {
  name: "ai.generateText",
  kind: "CLIENT",
  instrumentationScope: { name: "ai", version: "3.0" },
  statusMessage: null,
  statusCode: null,
} as any;

describe("CanonicalizeSpanAttributesService — chat message coercion", () => {
  describe("when messages are standard {role, content} format", () => {
    it("passes through gen_ai.input.messages as-is", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ];
      const result = service.canonicalize(
        { "gen_ai.input.messages": messages },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual(messages);
    });
  });

  describe("when messages have Anthropic content blocks", () => {
    it("preserves tool_use and tool_result content blocks", () => {
      const messages = [
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
              content: "Sunny, 22C",
            },
          ],
        },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": messages },
        [],
        stubSpan as any,
      );

      // Anthropic content blocks must survive the pipeline unchanged
      expect(result.attributes["gen_ai.input.messages"]).toEqual(messages);
    });
  });

  describe("when messages use Vercel AI SDK parts format", () => {
    it("preserves parts array, extracts system instruction from content field", () => {
      const messages = [
        {
          role: "system",
          content: [{ type: "text", content: "You are a helpful assistant." }],
        },
        {
          role: "user",
          parts: [{ type: "text", content: "Hello" }],
        },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": messages },
        [],
        stubSpan as any,
      );

      // Messages with parts format should be preserved
      expect(result.attributes["gen_ai.input.messages"]).toEqual(messages);

      // System instruction extracted from content blocks using 'content' field
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "You are a helpful assistant.",
      );
    });
  });

  describe("when input is a plain string (gen_ai.prompt)", () => {
    it("wraps in [{role: user, content: string}] as gen_ai.input.messages", () => {
      const result = service.canonicalize(
        { "gen_ai.prompt": "Tell me a joke" },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        { role: "user", content: "Tell me a joke" },
      ]);
    });
  });

  describe("when input is wrapped in {messages: [...]} object", () => {
    it("unwraps and sets gen_ai.input.messages", () => {
      const innerMessages = [
        { role: "user", content: "What time is it?" },
      ];
      const wrapped = JSON.stringify({ messages: innerMessages });

      const result = service.canonicalize(
        { "gen_ai.prompt": wrapped },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual(innerMessages);
    });
  });

  describe("when messages are wrapped in {message: {...}} objects", () => {
    it("unwraps each {message: {role, content}} to {role, content}", () => {
      const wrappedMessages = [
        { message: { role: "user", content: "Hello" } },
        { message: { role: "assistant", content: "Hi!" } },
      ];

      const result = service.canonicalize(
        { "gen_ai.prompt": JSON.stringify(wrappedMessages) },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ]);
    });

    it("leaves unwrapped messages alone in mixed arrays", () => {
      const mixedMessages = [
        { message: { role: "user", content: "Hello" } },
        { role: "assistant", content: "Hi!" },
      ];

      const result = service.canonicalize(
        { "gen_ai.prompt": JSON.stringify(mixedMessages) },
        [],
        stubSpan as any,
      );

      // First is unwrapped, second stays as-is
      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ]);
    });
  });

  describe("when output is a plain string (gen_ai.completion)", () => {
    it("wraps in [{role: assistant, content: string}] as gen_ai.output.messages", () => {
      const result = service.canonicalize(
        { "gen_ai.completion": "Here is a joke about cats." },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.output.messages"]).toEqual([
        { role: "assistant", content: "Here is a joke about cats." },
      ]);
    });
  });

  describe("when system message is first in input", () => {
    it("extracts content string to gen_ai.request.system_instruction", () => {
      const messages = [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hi" },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": JSON.stringify(messages) },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "You are a pirate.",
      );
    });

    it("extracts from structured content blocks [{type: text, text: ...}]", () => {
      const messages = [
        {
          role: "system",
          content: [
            { type: "text", text: "Part A." },
            { type: "text", text: " Part B." },
          ],
        },
        { role: "user", content: "Hi" },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": JSON.stringify(messages) },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "Part A. Part B.",
      );
    });

    it("extracts from Vercel parts [{type: text, content: ...}]", () => {
      const messages = [
        {
          role: "system",
          content: [{ type: "text", content: "Be helpful." }],
        },
        { role: "user", content: "Hey" },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": JSON.stringify(messages) },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "Be helpful.",
      );
    });

    it("does not extract when first message is not system role", () => {
      const messages = [
        { role: "user", content: "No system here" },
        { role: "assistant", content: "OK" },
      ];

      const result = service.canonicalize(
        { "gen_ai.input.messages": JSON.stringify(messages) },
        [],
        stubSpan as any,
      );

      expect(
        result.attributes["gen_ai.request.system_instruction"],
      ).toBeUndefined();
    });
  });

  describe("when multiple extractors could handle messages", () => {
    it("LangWatch extractor wins over GenAI for langwatch.input chat_messages", () => {
      const chatMessages = [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hello" },
      ];

      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: chatMessages,
          }),
          // GenAI extractor would normally handle gen_ai.prompt
          "gen_ai.prompt": "This should be ignored",
        },
        [],
        stubSpan as any,
      );

      // LangWatch runs first, sets gen_ai.input.messages from langwatch.input
      expect(result.attributes["gen_ai.input.messages"]).toEqual(chatMessages);
    });

    it("gen_ai.input.messages already set blocks llm.input_messages extraction", () => {
      const existingMessages = [
        { role: "user", content: "Already set" },
      ];
      const legacyMessages = [
        { role: "user", content: "Legacy fallback" },
      ];

      const result = service.canonicalize(
        {
          "gen_ai.input.messages": existingMessages,
          "llm.input_messages": legacyMessages,
        },
        [],
        stubSpan as any,
      );

      // gen_ai.input.messages was already present, llm.input_messages should not overwrite
      expect(result.attributes["gen_ai.input.messages"]).toEqual(existingMessages);
    });
  });
});
