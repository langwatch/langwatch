import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { SpanType } from "../types";
import {
  setupTestEnvironment,
  testData,
  testScenarios,
  performanceUtils
} from "./test-utils";
import * as intSemconv from "../semconv";
import semconv from "@opentelemetry/semantic-conventions/incubating";

describe("span.ts", () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe("createLangWatchSpan", () => {
    it("should create a LangWatchSpan from an OpenTelemetry Span", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();

      expect(langwatchSpan).toBeDefined();
      expect(typeof langwatchSpan.setType).toBe("function");
      expect(typeof langwatchSpan.setInput).toBe("function");
      expect(typeof langwatchSpan.setOutput).toBe("function");
    });

    it("should preserve OpenTelemetry Span methods", () => {
      const { langwatchSpan } = testScenarios.createSpanTest();

      expect(typeof langwatchSpan.setAttribute).toBe("function");
      expect(typeof langwatchSpan.setAttributes).toBe("function");
      expect(typeof langwatchSpan.addEvent).toBe("function");
      expect(typeof langwatchSpan.setStatus).toBe("function");
      expect(typeof langwatchSpan.end).toBe("function");
    });
  });

  describe("OpenTelemetry Span method compatibility", () => {
    it("should support fluent API for setAttribute", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.setAttribute("test.key", "test-value");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("test.key", "test-value");
    });

    it("should support fluent API for setAttributes", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const attributes = { "key1": "value1", "key2": "value2" };
      const result = langwatchSpan.setAttributes(attributes);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(attributes);
    });

    it("should support fluent API for addEvent", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.addEvent("test-event", { "event.data": "test" });

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.addEvent).toHaveBeenCalledWith("test-event", { "event.data": "test" });
    });

    it("should support fluent API for recordException", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const error = new Error("Test error");
      const result = langwatchSpan.recordException(error);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    });

    it("should support fluent API for setStatus", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const status = { code: SpanStatusCode.OK };
      const result = langwatchSpan.setStatus(status);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(status);
    });

    it("should support fluent API for updateName", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.updateName("new-name");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.updateName).toHaveBeenCalledWith("new-name");
    });

    it("should support fluent API for addLink", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const link = { context: mockSpan.spanContext() };
      const result = langwatchSpan.addLink(link);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.addLink).toHaveBeenCalledWith(link);
    });

    it("should support fluent API for addLinks", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const links = [{ context: mockSpan.spanContext() }];
      const result = langwatchSpan.addLinks(links);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.addLinks).toHaveBeenCalledWith(links);
    });

    it("should delegate non-fluent methods", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      // Test isRecording before ending
      const isRecordingBefore = langwatchSpan.isRecording();
      expect(isRecordingBefore).toBe(true);

      // Test spanContext
      const context = langwatchSpan.spanContext();
      expect(context).toEqual(mockSpan.spanContext());

      // Test end method
      langwatchSpan.end();
      expect(mockSpan.end).toHaveBeenCalled();

      // Test isRecording after ending
      const isRecordingAfter = langwatchSpan.isRecording();
      expect(isRecordingAfter).toBe(false);
    });
  });

  describe("setType", () => {
    it("should set the span type attribute", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.setType("llm");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_SPAN_TYPE,
        "llm"
      );
    });

    it("should accept all valid span types", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const validTypes: SpanType[] = ["span", "llm", "chain", "tool", "agent", "guardrail"];

      validTypes.forEach(type => {
        langwatchSpan.setType(type);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_SPAN_TYPE,
          type
        );
      });
    });
  });

  describe("setRequestModel and setResponseModel", () => {
    it("should set request model attribute", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.setRequestModel("gpt-4");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        semconv.ATTR_GEN_AI_REQUEST_MODEL,
        "gpt-4"
      );
    });

    it("should set response model attribute", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan.setResponseModel("gpt-4-turbo");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        semconv.ATTR_GEN_AI_RESPONSE_MODEL,
        "gpt-4-turbo"
      );
    });
  });

  describe("RAG context methods", () => {
    it("should set single RAG context", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const ragContext = testData.ragContext();
      const result = langwatchSpan.setRAGContext(ragContext);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
        JSON.stringify({
          type: "json",
          value: [ragContext],
        })
      );
    });

    it("should set multiple RAG contexts", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const ragContexts = testData.ragContexts();
      const result = langwatchSpan.setRAGContexts(ragContexts);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS,
        JSON.stringify({
          type: "json",
          value: ragContexts,
        })
      );
    });
  });

  describe("setMetrics", () => {
    it("should set metrics attribute", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const metrics = testData.metrics();
      const result = langwatchSpan.setMetrics(metrics);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_METRICS,
        JSON.stringify({
          type: "json",
          value: metrics,
        })
      );
    });

    it("should handle partial metrics", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const partialMetrics = { promptTokens: 100 };
      const result = langwatchSpan.setMetrics(partialMetrics);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_METRICS,
        JSON.stringify({
          type: "json",
          value: partialMetrics,
        })
      );
    });
  });

  describe("input/output methods", () => {
    describe("setInput", () => {
      it("should set JSON input", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const input = { prompt: "Hello", temperature: 0.7 };
        const result = langwatchSpan.setInput(input);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_INPUT,
          JSON.stringify({
            type: "json",
            value: input,
          })
        );
      });

      it("should handle string input", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const input = "Simple string input";
        const result = langwatchSpan.setInput(input);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_INPUT,
          JSON.stringify({
            type: "json",
            value: input,
          })
        );
      });

      it("should handle array input", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const input = ["item1", "item2", "item3"];
        const result = langwatchSpan.setInput(input);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_INPUT,
          JSON.stringify({
            type: "json",
            value: input,
          })
        );
      });
    });

    describe("setInputString", () => {
      it("should set string input with text type", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const input = "String input for LLM";
        const result = langwatchSpan.setInputString(input);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_INPUT,
          JSON.stringify({
            type: "text",
            value: input,
          })
        );
      });
    });

    describe("setOutput", () => {
      it("should set JSON output", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const output = { response: "Hello there!", tokens: 15 };
        const result = langwatchSpan.setOutput(output);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_OUTPUT,
          JSON.stringify({
            type: "json",
            value: output,
          })
        );
      });

      it("should handle string output", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const output = "Generated response";
        const result = langwatchSpan.setOutput(output);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_OUTPUT,
          JSON.stringify({
            type: "json",
            value: output,
          })
        );
      });
    });

    describe("setOutputString", () => {
      it("should set string output with text type", () => {
        const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
        const output = "Generated text response";
        const result = langwatchSpan.setOutputString(output);

        expect(result).toBe(langwatchSpan);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
          intSemconv.ATTR_LANGWATCH_OUTPUT,
          JSON.stringify({
            type: "text",
            value: output,
          })
        );
      });
    });
  });



  describe("method chaining", () => {
    it("should support fluent API chaining", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const result = langwatchSpan
        .setType("llm")
        .setRequestModel("gpt-4")
        .setResponseModel("gpt-4-turbo")
        .setInput("Hello")
        .addEvent("hehe")
        .setOutput("Hi there!")
        .setMetrics({ promptTokens: 10, completionTokens: 5 })
        .setRAGContext(testData.ragContext());

      expect(result).toBe(langwatchSpan);

      // Verify all methods were called
      expect(mockSpan.setAttribute).toHaveBeenCalledTimes(7); // type, request/response models, input, output, metrics, rag
      expect(mockSpan.addEvent).toHaveBeenCalledTimes(1); // hehe
    });
  });

  describe("edge cases", () => {
    it("should handle empty/null inputs gracefully", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      expect(() => langwatchSpan.setInput(null)).not.toThrow();
      expect(() => langwatchSpan.setInput(undefined)).not.toThrow();
      expect(() => langwatchSpan.setOutput(null)).not.toThrow();
      expect(() => langwatchSpan.setOutput(undefined)).not.toThrow();
    });

    it("should handle empty metrics", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      expect(() => langwatchSpan.setMetrics({})).not.toThrow();
    });

    it("should handle complex nested objects", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();
      const complexInput = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
        ],
        settings: {
          temperature: 0.7,
          max_tokens: 100,
          tools: [{ name: "calculator", type: "function" }],
        },
      };

      expect(() => langwatchSpan.setInput(complexInput)).not.toThrow();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        intSemconv.ATTR_LANGWATCH_INPUT,
        JSON.stringify({
          type: "json",
          value: complexInput,
        })
      );
    });
  });

  describe("behavioral testing", () => {
    it("should maintain proper span lifecycle", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();

      // Initially recording
      testScenarios.validateSpanLifecycle(mockSpan, {
        shouldBeRecording: true,
        shouldBeEnded: false
      });

      // Set some attributes and events
      langwatchSpan
        .setType("llm")
        .setInput("test input");

      // Still recording with data
      testScenarios.validateSpanLifecycle(mockSpan, {
        shouldBeRecording: true,
        shouldHaveAttributes: {
          [intSemconv.ATTR_LANGWATCH_SPAN_TYPE]: "llm"
        }
      });

      // End the span
      langwatchSpan.end();

      // Should be ended
      testScenarios.validateSpanLifecycle(mockSpan, {
        shouldBeRecording: false,
        shouldBeEnded: true
      });
    });

    it("should handle duplicate end() calls gracefully", () => {
      const { mockSpan, langwatchSpan } = testScenarios.createSpanTest();

      langwatchSpan.end();
      mockSpan.expectEnded();

      // Should not throw or change state
      langwatchSpan.end();
      langwatchSpan.end();

      expect(mockSpan.end).toHaveBeenCalledTimes(3);
      mockSpan.expectEnded(); // Still ended, not corrupted
    });
  });

  describe("performance characteristics", () => {
    it("should handle high-frequency attribute setting efficiently", async () => {
      const { langwatchSpan } = testScenarios.createSpanTest();

      const { duration } = await performanceUtils.measureTime(async () => {
        for (let i = 0; i < 1000; i++) {
          langwatchSpan.setAttribute(`test.key.${i}`, `value-${i}`);
        }
      });

      // Should complete within reasonable time (1ms per operation max)
      performanceUtils.expectPerformance(duration, { maxDuration: 1000 });
    });

    it("should handle concurrent method calls", async () => {
      const { langwatchSpan } = testScenarios.createSpanTest();

      const operations = await performanceUtils.createConcurrentOperations(
        async (i) => {
          langwatchSpan
            .setAttribute(`concurrent.${i}`, i)
            .addEvent(`event-${i}`)
            .setType("llm");
          return i;
        },
        50
      );

      expect(operations).toHaveLength(50);
      // All operations should complete successfully
      operations.forEach((result, index) => {
        expect(result).toBe(index);
      });
    });
  });
});
