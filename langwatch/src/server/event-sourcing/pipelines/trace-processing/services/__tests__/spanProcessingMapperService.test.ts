import { SpanStatusCode } from "@opentelemetry/api";
import type { IResource } from "@opentelemetry/otlp-transformer";
import { describe, expect, it } from "vitest";
import type { DeepPartial } from "../../../../../../utils/types";
import type { Span } from "../../../../../tracer/types";
import { GenAIAttributeMapperService } from "../genAIAttributeMapperService";
import { SpanProcessingMapperService } from "../spanProcessingMapperService";

describe("SpanProcessingMapperService", () => {
  const service = new SpanProcessingMapperService();
  const genAiMapper = new GenAIAttributeMapperService();

  describe("determineSpanStatus", () => {
    describe("when LangWatch span has error", () => {
      it("returns ERROR status with error message", () => {
        const langWatchError: Span["error"] = {
          has_error: true,
          message: "API request failed",
          stacktrace: [],
        };
        const otelStatus = undefined;

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("API request failed");
      });

      it("overrides OTEL OK status", () => {
        const langWatchError: Span["error"] = {
          has_error: true,
          message: "LangWatch error",
          stacktrace: [],
        };
        const otelStatus = { code: 1 }; // OK

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("LangWatch error");
      });
    });

    describe("when OTEL status is ERROR", () => {
      it("returns ERROR status with numeric code 2", () => {
        const langWatchError = null;
        const otelStatus = { code: 2, message: "OTEL error" };

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("OTEL error");
      });

      it("returns ERROR status with string code containing ERROR", () => {
        const langWatchError = null;
        const otelStatus = {
          code: "STATUS_CODE_ERROR" as any,
          message: "Error occurred",
        };

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("Error occurred");
      });
    });

    describe("when OTEL status is OK", () => {
      it("returns OK status with numeric code 1", () => {
        const langWatchError = null;
        const otelStatus = { code: 1 };

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
      });

      it("returns OK status with string code containing OK", () => {
        const langWatchError = null;
        const otelStatus = { code: "STATUS_CODE_OK" as any };

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
      });
    });

    describe("when no error information", () => {
      it("returns OK status by default", () => {
        const langWatchError = null;
        const otelStatus = undefined;

        const result = service.determineSpanStatus(langWatchError, otelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
      });
    });
  });

  describe("buildResourceAttributes", () => {
    describe("when resource has valid attributes", () => {
      it("extracts string attributes", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            { key: "service.name", value: { stringValue: "my-service" } },
            { key: "service.version", value: { stringValue: "1.0.0" } },
          ],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result["service.name"]).toBe("my-service");
        expect(result["service.version"]).toBe("1.0.0");
      });

      it("extracts number attributes", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            { key: "service.port", value: { intValue: 8080 } },
            { key: "service.timeout", value: { doubleValue: 30.5 } },
          ],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result["service.port"]).toBe(8080);
        expect(result["service.timeout"]).toBe(30.5);
      });

      it("extracts boolean attributes", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [{ key: "service.enabled", value: { boolValue: true } }],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result["service.enabled"]).toBe(true);
      });

      it("extracts array attributes", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "service.tags",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "production" },
                    { stringValue: "api" },
                  ],
                },
              },
            },
          ],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result["service.tags"]).toEqual(["production", "api"]);
      });
    });

    describe("when resource has invalid attributes", () => {
      it("filters out attributes with undefined values", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            { key: "valid", value: { stringValue: "value" } },
            { key: "invalid", value: {} },
          ],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result.valid).toBe("value");
        expect(result.invalid).toBeUndefined();
      });

      it("filters out attributes with null values in arrays", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "mixed.array",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "valid" },
                    {},
                    { stringValue: "also-valid" },
                  ],
                },
              },
            },
          ],
        };

        const result = service.buildResourceAttributes(resource);

        // Array with null/undefined values should still be included
        expect(Array.isArray(result["mixed.array"])).toBe(true);
      });
    });

    describe("when resource is empty or undefined", () => {
      it("returns empty object when resource is undefined", () => {
        const result = service.buildResourceAttributes(undefined);

        expect(result).toEqual({});
      });

      it("returns empty object when attributes is undefined", () => {
        const resource: DeepPartial<IResource> = {};

        const result = service.buildResourceAttributes(resource);

        expect(result).toEqual({});
      });

      it("returns empty object when attributes is empty array", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result).toEqual({});
      });
    });

    describe("when attribute key is missing", () => {
      it("skips attributes without keys", () => {
        const resource: DeepPartial<IResource> = {
          attributes: [
            { key: "valid", value: { stringValue: "value" } },
            { value: { stringValue: "no-key" } } as any,
          ],
        };

        const result = service.buildResourceAttributes(resource);

        expect(result.valid).toBe("value");
        expect(Object.keys(result)).toHaveLength(1);
      });
    });
  });

  describe("system instruction extraction", () => {
    describe("when input has system message as first message", () => {
      it("extracts system instruction and removes from messages", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBe(
          "You are a helpful assistant.",
        );
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      });

      it("extracts system instruction from rich content array", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              {
                role: "system",
                content: [
                  { type: "text", text: "You are helpful." },
                  { type: "text", text: "Be concise." },
                ],
              },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBe(
          "You are helpful.\nBe concise.",
        );
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      });

      it("handles system message with only non-text rich content", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              {
                role: "system",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: "https://example.com/image.jpg" },
                  },
                ],
              },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        // System instruction should be empty string (no text content)
        expect(result["gen_ai.request.system_instruction"]).toBe("");
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      });
    });

    describe("when input has no system message", () => {
      it("does not set system instruction attribute", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there!" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({ role: "user", content: "Hello" });
        expect(messages[1]).toEqual({
          role: "assistant",
          content: "Hi there!",
        });
      });

      it("handles system message not as first message", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "user", content: "Hello" },
              { role: "system", content: "You are helpful." },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        // System message not first, so not extracted
        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(2);
        expect(messages[1]).toEqual({
          role: "system",
          content: "You are helpful.",
        });
      });
    });

    describe("when input is text type", () => {
      it("does not extract system instruction from text input", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "text",
            value: "Hello, world!",
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({ role: "user", content: "Hello, world!" });
      });
    });

    describe("when input is empty or null", () => {
      it("returns empty attributes when input is null", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: null,
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result).toEqual({});
        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
      });

      it("returns empty attributes when input is undefined", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result).toEqual({});
        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
      });
    });

    describe("when span is not LLM type", () => {
      it("does not extract system instruction", () => {
        const span: Span = {
          type: "tool",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: "You are helpful." },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result).toEqual({});
        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
      });
    });

    describe("when system message has empty content", () => {
      it("sets system instruction to empty string", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: "" },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBe("");
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(1);
      });

      it("handles system message with null content", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: null },
              { role: "user", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapInputAttributes(span);

        // null content should not set system instruction
        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
        const messages = JSON.parse(result["gen_ai.input.messages"]);
        expect(messages).toHaveLength(2);
      });
    });

    describe("when output has system message", () => {
      it("does not extract system instruction from output", () => {
        const span: Span = {
          type: "llm",
          span_id: "span-1",
          name: "test-span",
          output: {
            type: "chat_messages",
            value: [
              { role: "system", content: "You are helpful." },
              { role: "assistant", content: "Hello" },
            ],
          },
        } as Span;

        const result = (genAiMapper as any).mapOutputAttributes(span);

        expect(result["gen_ai.request.system_instruction"]).toBeUndefined();
        const messages = JSON.parse(result["gen_ai.output.messages"]);
        expect(messages).toHaveLength(2);
        // System message should remain in output messages
        expect(messages[0]).toEqual({
          role: "system",
          content: "You are helpful.",
        });
      });
    });
  });
});
