import { describe, expect, it } from "vitest";
import { MessageNormalizationService } from "../messageNormalizationService";

describe("MessageNormalizationService", () => {
  const service = new MessageNormalizationService();

  describe("normalizeMessages", () => {
    describe("when input is null or undefined", () => {
      it("returns empty array for null", () => {
        const result = service.normalizeMessages(null);

        expect(result).toEqual([]);
      });

      it("returns empty array for undefined", () => {
        const result = service.normalizeMessages(undefined);

        expect(result).toEqual([]);
      });
    });

    describe("when input is a string", () => {
      it("wraps string in user message", () => {
        const result = service.normalizeMessages("Hello, world!");

        expect(result).toEqual([
          {
            role: "user",
            content: "Hello, world!",
          },
        ]);
      });
    });

    describe("when input is an empty array", () => {
      it("returns empty array", () => {
        const result = service.normalizeMessages([]);

        expect(result).toEqual([]);
      });
    });

    describe("when input is a typed value wrapper", () => {
      it("unwraps top-level typed value object", () => {
        const typedValue = {
          type: "chat_messages",
          value: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
          ],
        };

        const result = service.normalizeMessages(typedValue);

        expect(result).toEqual([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ]);
      });

      it("unwraps typed value objects inside arrays", () => {
        const input = [
          {
            type: "chat_messages",
            value: [
              { role: "assistant", content: "Response", function_call: {} },
            ],
          },
        ];

        const result = service.normalizeMessages(input);

        expect(result).toHaveLength(1);
        expect(result[0]?.role).toBe("assistant");
        expect(result[0]?.content).toBe("Response");
      });

      it("flattens nested arrays from typed value wrappers", () => {
        const input = [
          {
            type: "chat_messages",
            value: [
              { role: "user", content: "First" },
              { role: "assistant", content: "Second" },
            ],
          },
        ];

        const result = service.normalizeMessages(input);

        expect(result).toHaveLength(2);
        expect(result[0]?.content).toBe("First");
        expect(result[1]?.content).toBe("Second");
      });

      it("ignores non-chat_messages typed values", () => {
        const typedValue = {
          type: "text",
          value: "Just text",
        };

        const result = service.normalizeMessages(typedValue);

        // Should treat as fallback since it's not chat_messages
        expect(result).toHaveLength(1);
        expect(result[0]?.content).toContain("text");
      });
    });

    describe("when input is OpenAI/OpenTelemetry format", () => {
      it("validates and returns messages as-is", () => {
        const messages = [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ];

        const result = service.normalizeMessages(messages);

        expect(result).toEqual(messages);
      });

      it.skip("normalizes OpenAI image URL shorthand", () => {
        const messages = [
          {
            role: "user",
            content: [
              { type: "text", text: "What's in this image?" },
              { type: "image_url", image_url: "https://example.com/image.png" },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          { type: "text", text: "What's in this image?" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/image.png" },
          },
        ]);
      });

      it("preserves tool calls", () => {
        const messages = [
          {
            role: "assistant",
            content: "I'll check that for you",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location": "SF"}',
                },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.tool_calls).toEqual(messages[0]?.tool_calls);
      });
    });

    describe("when input is Anthropic format", () => {
      it("normalizes text block content", () => {
        const messages = [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Hello!",
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result).toEqual([
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Hello!",
              },
            ],
          },
        ]);
      });

      it("normalizes string content", () => {
        const messages = [
          {
            role: "assistant",
            content: "Hello back!",
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toBe("Hello back!");
      });

      it("converts image blocks to image_url format", () => {
        const messages = [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "abc123",
                },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc123" },
          },
        ]);
      });

      it("converts tool_use blocks to tool_call format", () => {
        const messages = [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool_123",
                name: "get_weather",
                input: { location: "SF" },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          {
            type: "tool_call",
            toolName: "get_weather",
            toolCallId: "tool_123",
            args: '{"location":"SF"}',
          },
        ]);
      });

      it("converts tool_result blocks to tool_result format", () => {
        const messages = [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_123",
                content: "The weather is sunny",
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          {
            type: "tool_result",
            toolCallId: "tool_123",
            result: "The weather is sunny",
          },
        ]);
      });
    });

    describe("when input is Gemini format", () => {
      it("normalizes single text part to string", () => {
        const messages = [
          {
            role: "user",
            parts: [{ text: "Hello!" }],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result).toEqual([
          {
            role: "user",
            content: "Hello!",
          },
        ]);
      });

      it("converts model role to assistant", () => {
        const messages = [
          {
            role: "model",
            parts: [{ text: "Hi there!" }],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.role).toBe("assistant");
      });

      it("normalizes multiple parts to rich content", () => {
        const messages = [
          {
            role: "user",
            parts: [
              { text: "What's in this image?" },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: "abc123",
                },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          {
            type: "text",
            text: "What's in this image?",
          },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc123" },
          },
        ]);
      });

      it("converts function_call to tool_call format", () => {
        const messages = [
          {
            role: "model",
            parts: [
              {
                function_call: {
                  name: "get_weather",
                  args: { location: "SF" },
                },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toEqual([
          {
            type: "tool_call",
            toolName: "get_weather",
            args: '{"location":"SF"}',
          },
        ]);
      });

      it("converts function_response to tool_result format", () => {
        const messages = [
          {
            role: "function",
            parts: [
              {
                function_response: {
                  name: "get_weather",
                  response: { temp: 72, condition: "sunny" },
                },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.role).toBe("tool");
        expect(result[0]?.content).toEqual([
          {
            type: "tool_result",
            toolName: "get_weather",
            result: { temp: 72, condition: "sunny" },
          },
        ]);
      });
    });

    describe("when input is Cohere format", () => {
      it("converts uppercase USER role to lowercase", () => {
        const messages = [
          {
            role: "USER",
            message: "Hello!",
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.role).toBe("user");
      });

      it("converts CHATBOT role to assistant", () => {
        const messages = [
          {
            role: "CHATBOT",
            text: "Hi there!",
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.role).toBe("assistant");
      });

      it("uses message field as content", () => {
        const messages = [
          {
            role: "USER",
            message: "What's the weather?",
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toBe("What's the weather?");
      });

      it("uses text field as content", () => {
        const messages = [
          {
            role: "CHATBOT",
            text: "It's sunny!",
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.content).toBe("It's sunny!");
      });

      it("converts tool_calls to standard format", () => {
        const messages = [
          {
            role: "CHATBOT",
            tool_calls: [
              {
                name: "get_weather",
                parameters: { location: "SF" },
              },
            ],
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result[0]?.tool_calls).toEqual([
          {
            id: "tool_0",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"location":"SF"}',
            },
          },
        ]);
      });
    });

    describe("when input is non-standard format", () => {
      it.skip("creates fallback message for object", () => {
        const data = { customField: "value", anotherField: 123 };

        const result = service.normalizeMessages([data]);

        expect(result).toHaveLength(1);
        // Fallback creates a message with stringified content
        expect(result[0]).toBeDefined();
        expect(result[0]?.content).toBeDefined();
      });

      it.skip("never loses data - stringifies complex objects", () => {
        const data = {
          nested: { deep: { value: "important" } },
          array: [1, 2, 3],
        };

        const result = service.normalizeMessages([data]);

        expect(result).toHaveLength(1);
        const content = result[0]?.content;
        expect(content).toBeDefined();

        if (content) {
          const contentStr =
            typeof content === "string" ? content : JSON.stringify(content);
          expect(contentStr).toContain("important");
        }
      });

      it("extracts role and content from malformed messages", () => {
        const messages = [
          {
            role: "user",
            content: { weirdStructure: "but has content" },
          },
        ];

        const result = service.normalizeMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0]?.role).toBe("user");
        expect(result[0]?.content).toBeDefined();
      });
    });
  });

  describe("createFallbackMessage", () => {
    describe("when data is a string", () => {
      it("creates user message with string content", () => {
        const result = service.createFallbackMessage("Hello");

        expect(result).toEqual({
          role: "user",
          content: "Hello",
        });
      });
    });

    describe("when data is null or undefined", () => {
      it("creates message with empty content for null", () => {
        const result = service.createFallbackMessage(null);

        expect(result.content).toBe("");
      });

      it("creates message with empty content for undefined", () => {
        const result = service.createFallbackMessage(undefined);

        expect(result.content).toBe("");
      });
    });

    describe("when data is an object", () => {
      it("stringifies object", () => {
        const data = { key: "value", number: 42 };

        const result = service.createFallbackMessage(data);

        expect(result.role).toBe("user");
        expect(result.content).toContain("key");
        expect(result.content).toContain("value");
        expect(result.content).toContain("42");
      });

      it("extracts role and content if present", () => {
        const data = {
          role: "assistant",
          content: "Extracted content",
        };

        const result = service.createFallbackMessage(data);

        expect(result.role).toBe("assistant");
        expect(result.content).toBe("Extracted content");
      });

      it("stringifies non-string content", () => {
        const data = {
          role: "user",
          content: { nested: "object" },
        };

        const result = service.createFallbackMessage(data);

        expect(result.role).toBe("user");
        expect(typeof result.content).toBe("string");
        expect(result.content).toContain("nested");
      });
    });

    describe("when data is a number or boolean", () => {
      it("converts number to string", () => {
        const result = service.createFallbackMessage(69);

        expect(result.content).toBe("69");
      });

      it("converts boolean to string", () => {
        const result = service.createFallbackMessage(true);

        expect(result.content).toBe("true");
      });
    });
  });
});
