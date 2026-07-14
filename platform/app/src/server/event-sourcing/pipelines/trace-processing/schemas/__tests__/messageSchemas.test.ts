import { describe, expect, it } from "vitest";
import {
  AnthropicMessage,
  AnyProviderMessage,
  BedrockClaudeMessage,
  CohereMessage,
  detectMessageFormat,
  GeminiMessage,
  MessageFormat,
  OpenAIMessage,
  OpenTelemetryGenAIMessage,
} from "../messageSchemas";

describe("messageSchemas", () => {
  describe("OpenTelemetryGenAIMessage", () => {
    describe("when message has valid structure", () => {
      it("validates simple text message", () => {
        const message = {
          role: "user",
          content: "Hello, world!",
        };

        const result = OpenTelemetryGenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.role).toBe("user");
          expect(result.data.content).toBe("Hello, world!");
        }
      });

      it("validates message with rich content array", () => {
        const message = {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.png" },
            },
          ],
        };

        const result = OpenTelemetryGenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with tool calls", () => {
        const message = {
          role: "assistant",
          content: "I'll help you with that",
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
        };

        const result = OpenTelemetryGenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with null content", () => {
        const message = {
          role: "system",
          content: null,
        };

        const result = OpenTelemetryGenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("OpenAIMessage", () => {
    describe("when message has OpenAI structure", () => {
      it("validates user message", () => {
        const message = {
          role: "user",
          content: "What's the weather?",
        };

        const result = OpenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with image URL string shorthand", () => {
        const message = {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            { type: "image_url", image_url: "https://example.com/image.png" },
          ],
        };

        const result = OpenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with function call", () => {
        const message = {
          role: "assistant",
          function_call: {
            name: "get_weather",
            arguments: '{"location": "SF"}',
          },
        };

        const result = OpenAIMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("AnthropicMessage", () => {
    describe("when message has Anthropic structure", () => {
      it("validates message with text block", () => {
        const message = {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello!",
            },
          ],
        };

        const result = AnthropicMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with string content", () => {
        const message = {
          role: "assistant",
          content: "Hello back!",
        };

        const result = AnthropicMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with image block", () => {
        const message = {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgA...",
              },
            },
          ],
        };

        const result = AnthropicMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with tool use block", () => {
        const message = {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "get_weather",
              input: { location: "SF" },
            },
          ],
        };

        const result = AnthropicMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("GeminiMessage", () => {
    describe("when message has Gemini structure", () => {
      it("validates message with text part", () => {
        const message = {
          role: "user",
          parts: [{ text: "Hello!" }],
        };

        const result = GeminiMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with function call", () => {
        const message = {
          role: "model",
          parts: [
            {
              function_call: {
                name: "get_weather",
                args: { location: "SF" },
              },
            },
          ],
        };

        const result = GeminiMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with inline data", () => {
        const message = {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: "image/png",
                data: "base64data...",
              },
            },
          ],
        };

        const result = GeminiMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("CohereMessage", () => {
    describe("when message has Cohere structure", () => {
      it("validates user message with message field", () => {
        const message = {
          role: "USER",
          message: "What's the weather?",
        };

        const result = CohereMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates chatbot message with text field", () => {
        const message = {
          role: "CHATBOT",
          text: "It's sunny!",
        };

        const result = CohereMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with tool calls", () => {
        const message = {
          role: "CHATBOT",
          tool_calls: [
            {
              name: "get_weather",
              parameters: { location: "SF" },
            },
          ],
        };

        const result = CohereMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("BedrockClaudeMessage", () => {
    describe("when message has Bedrock Claude structure", () => {
      it("validates simple text message", () => {
        const message = {
          role: "user",
          content: "Hello!",
        };

        const result = BedrockClaudeMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates message with content blocks", () => {
        const message = {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Hello back!",
            },
          ],
        };

        const result = BedrockClaudeMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("AnyProviderMessage", () => {
    describe("when message is from any supported provider", () => {
      it("validates OpenAI format", () => {
        const message = {
          role: "user",
          content: "Hello",
        };

        const result = AnyProviderMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates Anthropic format", () => {
        const message = {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        };

        const result = AnyProviderMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates Gemini format", () => {
        const message = {
          role: "user",
          parts: [{ text: "Hello" }],
        };

        const result = AnyProviderMessage.safeParse(message);

        expect(result.success).toBe(true);
      });

      it("validates Cohere format", () => {
        const message = {
          role: "USER",
          message: "Hello",
        };

        const result = AnyProviderMessage.safeParse(message);

        expect(result.success).toBe(true);
      });
    });
  });

  describe("detectMessageFormat", () => {
    describe("when messages are in OpenAI/OpenTelemetry format", () => {
      it("detects OpenAI format", () => {
        const messages = [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.OpenAI);
      });
    });

    describe("when messages are in Gemini format", () => {
      it("detects Gemini format from parts array", () => {
        const messages = [
          { role: "user", parts: [{ text: "Hello" }] },
          { role: "model", parts: [{ text: "Hi" }] },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Gemini);
      });
    });

    describe("when messages are in Cohere format", () => {
      it("detects Cohere format from uppercase roles", () => {
        const messages = [
          { role: "USER", message: "Hello" },
          { role: "CHATBOT", text: "Hi" },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Cohere);
      });
    });

    describe("when messages are in Anthropic format", () => {
      it("detects Anthropic format from Anthropic-specific block types", () => {
        // Text blocks are identical in OpenAI and Anthropic, so we can only
        // detect Anthropic format when there are Anthropic-specific block types
        const messages = [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "image", source: { type: "base64", data: "..." } },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Hi" }],
          },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Anthropic);
      });

      it("detects Anthropic format from tool_use blocks", () => {
        const messages = [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call-1",
                name: "get_weather",
                input: {},
              },
            ],
          },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Anthropic);
      });

      it("detects Anthropic format from tool_result blocks", () => {
        const messages = [
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "call-1", content: "sunny" },
            ],
          },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Anthropic);
      });
    });

    describe("when messages have text-only rich content (OpenAI/Anthropic ambiguous)", () => {
      it("defaults to OpenAI format for text-only rich content blocks", () => {
        // Both OpenAI and Anthropic use { type: "text", text: "..." } for text blocks.
        // Since we cannot distinguish between them, we default to OpenAI format.
        const messages = [
          {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Hi" }],
          },
        ];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.OpenAI);
      });
    });

    describe("when messages are in unknown format", () => {
      it("returns Unknown for empty array", () => {
        const format = detectMessageFormat([]);

        expect(format).toBe(MessageFormat.Unknown);
      });

      it("returns Unknown for non-array", () => {
        const format = detectMessageFormat("not an array");

        expect(format).toBe(MessageFormat.Unknown);
      });

      it("returns Unknown for invalid message structure", () => {
        const messages = [{ invalidField: "value" }];

        const format = detectMessageFormat(messages);

        expect(format).toBe(MessageFormat.Unknown);
      });
    });
  });
});
