import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { setupObservability } from "../../setup/node";
import { getLangWatchTracer } from "../../tracer";
import { createLangWatchSpan } from "../../span";
import { NoOpLogger } from "../../../logger";
import * as semconv from "../../semconv";
import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Integration tests for LangWatch spans with real OpenTelemetry setup.
 *
 * These tests verify:
 * - Real span data serialization and export
 * - Data format consistency across different input types
 * - Event recording and attribute setting
 * - Integration with OpenTelemetry span lifecycle
 */

// Test data constants for consistency
const COMPLEX_TEST_INPUT = {
  messages: [
    { role: "user", content: "Hello" },
    { role: "system", content: "You are helpful" },
  ],
  config: {
    temperature: 0.7,
    maxTokens: 150,
    model: "gpt-4",
  },
  metadata: {
    userId: "user-123",
    sessionId: "session-456",
    timestamp: "2024-01-15T10:30:00Z",
  },
  features: ["chat", "analysis"],
  enabled: true,
  count: 42,
  score: null,
} as const;

const COMPLEX_TEST_OUTPUT = {
  response: {
    text: "Hello! How can I help you today?",
    confidence: 0.95,
    reasoning: ["greeting_detected", "help_offered"],
  },
  usage: {
    promptTokens: 25,
    completionTokens: 15,
  },
  timing: {
    startTime: "2024-01-15T10:30:00.123Z",
    endTime: "2024-01-15T10:30:01.456Z",
    latencyMs: 1333,
  },
} as const;

describe("Span Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    // Reset OpenTelemetry global state
    vi.resetModules();

    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    observabilityHandle = setupObservability({
      serviceName: "span-integration-test",
      logger: new NoOpLogger(),
      throwOnSetupError: true,
      attributes: {
        "test.suite": "span-integration",
        "test.component": "span-data-formats",
      },
      spanProcessors: [spanProcessor],
    });
  });

  afterEach(async () => {
    await observabilityHandle.shutdown();
    spanExporter.reset();
    trace.disable();
  });

  describe("data format serialization", () => {
    it("should serialize complex input/output data correctly", async () => {
      const tracer = getLangWatchTracer("data-serialization-test");

      await tracer.withActiveSpan("complex-data-test", async (span) => {
        span
          .setType("llm")
          .setInput(COMPLEX_TEST_INPUT)
          .setOutput(COMPLEX_TEST_OUTPUT);
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Verify input serialization
      const inputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(inputData.type).toBe("json");
      expect(inputData.value.messages).toHaveLength(2);
      expect(inputData.value.messages[0].role).toBe("user");
      expect(inputData.value.config.temperature).toBe(0.7);
      expect(inputData.value.metadata.userId).toBe("user-123");
      expect(inputData.value.features).toEqual(["chat", "analysis"]);
      expect(inputData.value.enabled).toBe(true);
      expect(inputData.value.count).toBe(42);
      expect(inputData.value.score).toBe(null);

      // Verify output serialization
      const outputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string,
      );
      expect(outputData.type).toBe("json");
      expect(outputData.value.response.text).toBe(
        "Hello! How can I help you today?",
      );
      expect(outputData.value.response.confidence).toBe(0.95);
      expect(outputData.value.response.reasoning).toEqual([
        "greeting_detected",
        "help_offered",
      ]);
      expect(outputData.value.usage.promptTokens).toBe(25);
      expect(outputData.value.timing.latencyMs).toBe(1333);
    });

    it("should handle edge cases in data serialization", async () => {
      const tracer = getLangWatchTracer("edge-cases-test");

      const edgeCaseData = {
        emptyString: "",
        emptyArray: [] as any[],
        emptyObject: {},
        nullValue: null,
        undefinedValue: undefined, // This should be omitted in JSON
        numberZero: 0,
        booleanFalse: false,
        specialChars: "Special chars: 🚀 \n\t\r \"quotes\" 'apostrophes'",
        unicodeText: "Café, naïve, 北京, 🌟",
        largeNumber: Number.MAX_SAFE_INTEGER,
        floatingPoint: Math.PI,
        scientificNotation: 1e-10,
        nestedEmpty: {
          level1: {
            level2: {
              level3: [] as any[],
            },
          },
        },
      };

      await tracer.withActiveSpan("edge-cases-span", async (span) => {
        span
          .setType("tool")
          .setInput(edgeCaseData)
          .setOutput({
            processed: true,
            originalLength: JSON.stringify(edgeCaseData).length,
          });
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      const inputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(inputData.type).toBe("json");
      expect(inputData.value.emptyString).toBe("");
      expect(inputData.value.emptyArray).toEqual([]);
      expect(inputData.value.emptyObject).toEqual({});
      expect(inputData.value.nullValue).toBe(null);
      expect(inputData.value.undefinedValue).toBeUndefined(); // Should be omitted
      expect(inputData.value.numberZero).toBe(0);
      expect(inputData.value.booleanFalse).toBe(false);
      expect(inputData.value.specialChars).toContain("🚀");
      expect(inputData.value.unicodeText).toContain("北京");
      expect(inputData.value.largeNumber).toBe(Number.MAX_SAFE_INTEGER);
      expect(inputData.value.floatingPoint).toBeCloseTo(Math.PI);
      expect(inputData.value.scientificNotation).toBe(1e-10);
      expect(inputData.value.nestedEmpty.level1.level2.level3).toEqual([]);
    });

    it("should properly format string vs JSON inputs", async () => {
      const tracer = getLangWatchTracer("format-comparison-test");

      const testString = "This is a plain text input with special chars: 🎯";
      const testObject = {
        text: testString,
        type: "plain",
        length: testString.length,
      };

      await tracer.withActiveSpan("string-input-span", async (span) => {
        span
          .setType("llm")
          .setInputString(testString)
          .setOutputString("Processed: " + testString);
      });

      await tracer.withActiveSpan("object-input-span", async (span) => {
        span
          .setType("llm")
          .setInput(testObject)
          .setOutput({ result: "Processed object", original: testObject });
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(2);

      const stringSpan = exportedSpans.find(
        (s) => s.name === "string-input-span",
      );
      const objectSpan = exportedSpans.find(
        (s) => s.name === "object-input-span",
      );

      if (!stringSpan || !objectSpan) {
        throw new Error("Expected both string and object spans to be exported");
      }

      // Verify string format
      const stringInputData = JSON.parse(
        stringSpan.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(stringInputData.type).toBe("text");
      expect(stringInputData.value).toBe(testString);

      const stringOutputData = JSON.parse(
        stringSpan.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string,
      );
      expect(stringOutputData.type).toBe("text");
      expect(stringOutputData.value).toBe("Processed: " + testString);

      // Verify object format
      const objectInputData = JSON.parse(
        objectSpan.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(objectInputData.type).toBe("json");
      expect(objectInputData.value.text).toBe(testString);
      expect(objectInputData.value.type).toBe("plain");

      const objectOutputData = JSON.parse(
        objectSpan.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string,
      );
      expect(objectOutputData.type).toBe("json");
      expect(objectOutputData.value.result).toBe("Processed object");
      expect(objectOutputData.value.original.text).toBe(testString);
    });

    it("should maintain consistent JSON serialization formats across all data types", async () => {
      const tracer = getLangWatchTracer("comprehensive-serialization-test");

      const comprehensiveTestData = {
        text: "string input",
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: "value" },
        nullValue: null,
      };

      await tracer.withActiveSpan("comprehensive-format-test", async (span) => {
        span
          .setType("tool")
          .setInput(comprehensiveTestData)
          .setRAGContexts([
            {
              document_id: "doc-1",
              chunk_id: "chunk-1",
              content: "First context",
            },
            {
              document_id: "doc-2",
              chunk_id: "chunk-2",
              content: "Second context",
            },
          ])
          .setMetrics({
            promptTokens: 100,
            completionTokens: 50,
            cost: 0.005,
          })
          .setOutput({
            processed: true,
            originalData: comprehensiveTestData,
            timestamp: "2024-01-15T10:30:00Z",
          });
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Verify input data format consistency
      const inputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(inputData.type).toBe("json");
      expect(inputData.value.text).toBe("string input");
      expect(inputData.value.number).toBe(42);
      expect(inputData.value.boolean).toBe(true);
      expect(inputData.value.array).toEqual([1, 2, 3]);
      expect(inputData.value.nested.key).toBe("value");
      expect(inputData.value.nullValue).toBe(null);

      // Verify RAG contexts format
      const ragData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_RAG_CONTEXTS] as string,
      );
      expect(ragData.type).toBe("json");
      expect(ragData.value).toHaveLength(2);
      expect(ragData.value[0].document_id).toBe("doc-1");
      expect(ragData.value[1].document_id).toBe("doc-2");

      // Verify metrics format
      const metricsData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_METRICS] as string,
      );
      expect(metricsData.type).toBe("json");
      expect(metricsData.value.promptTokens).toBe(100);
      expect(metricsData.value.completionTokens).toBe(50);
      expect(metricsData.value.cost).toBeCloseTo(0.005);

      // Verify output format
      const outputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string,
      );
      expect(outputData.type).toBe("json");
      expect(outputData.value.processed).toBe(true);
      expect(outputData.value.originalData.text).toBe("string input");
    });
  });

  describe("attributes and metadata", () => {
    it("should handle RAG context data correctly", async () => {
      const tracer = getLangWatchTracer("rag-context-test");

      const singleContext = {
        document_id: "doc-789",
        chunk_id: "chunk-012",
        content: "RAG context content with special chars: 🔍",
        metadata: {
          score: 0.95,
          source: "knowledge_base",
          lastUpdated: "2024-01-15",
        },
      };

      const multipleContexts = [
        {
          document_id: "doc-001",
          chunk_id: "chunk-001",
          content: "First context chunk",
        },
        {
          document_id: "doc-002",
          chunk_id: "chunk-002",
          content: "Second context chunk",
        },
        {
          document_id: "doc-003",
          chunk_id: "chunk-003",
          content: "Third context chunk",
        },
      ];

      await tracer.withActiveSpan("single-rag-context", async (span) => {
        span.setType("rag").setRAGContext(singleContext);
      });

      await tracer.withActiveSpan("multiple-rag-contexts", async (span) => {
        span.setType("rag").setRAGContexts(multipleContexts);
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(2);

      const singleSpan = exportedSpans.find(
        (s) => s.name === "single-rag-context",
      );
      const multipleSpan = exportedSpans.find(
        (s) => s.name === "multiple-rag-contexts",
      );

      if (!singleSpan || !multipleSpan) {
        throw new Error("Expected both RAG context spans to be exported");
      }

      // Verify single RAG context
      const singleRagData = JSON.parse(
        singleSpan.attributes[semconv.ATTR_LANGWATCH_RAG_CONTEXTS] as string,
      );
      expect(singleRagData.type).toBe("json");
      expect(singleRagData.value).toHaveLength(1);
      expect(singleRagData.value[0].document_id).toBe("doc-789");
      expect(singleRagData.value[0].chunk_id).toBe("chunk-012");
      expect(singleRagData.value[0].content).toContain("🔍");
      expect(singleRagData.value[0].metadata.score).toBe(0.95);

      // Verify multiple RAG contexts
      const multipleRagData = JSON.parse(
        multipleSpan.attributes[semconv.ATTR_LANGWATCH_RAG_CONTEXTS] as string,
      );
      expect(multipleRagData.type).toBe("json");
      expect(multipleRagData.value).toHaveLength(3);
      expect(multipleRagData.value[0].document_id).toBe("doc-001");
      expect(multipleRagData.value[1].document_id).toBe("doc-002");
      expect(multipleRagData.value[2].document_id).toBe("doc-003");
    });

    it("should handle metrics data with various number types", async () => {
      const tracer = getLangWatchTracer("metrics-test");

      const metricsData = {
        promptTokens: 150,
        completionTokens: 75,
        cost: 0.0045, // Floating point
        customMetric: 42, // Additional valid metric
      };

      await tracer.withActiveSpan("metrics-span", async (span) => {
        span.setType("llm").setMetrics(metricsData);
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      const parsedMetrics = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_METRICS] as string,
      );
      expect(parsedMetrics.type).toBe("json");
      expect(parsedMetrics.value.promptTokens).toBe(150);
      expect(parsedMetrics.value.completionTokens).toBe(75);
      expect(parsedMetrics.value.cost).toBeCloseTo(0.0045);
      expect(parsedMetrics.value.customMetric).toBe(42);
    });

    it("should set model attributes correctly", async () => {
      const tracer = getLangWatchTracer("model-attributes-test");

      await tracer.withActiveSpan("model-span", async (span) => {
        span
          .setType("llm")
          .setRequestModel("gpt-4-turbo-preview")
          .setResponseModel("gpt-4-turbo-preview-20240125");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.attributes["gen_ai.request.model"]).toBe(
        "gpt-4-turbo-preview",
      );
      expect(span.attributes["gen_ai.response.model"]).toBe(
        "gpt-4-turbo-preview-20240125",
      );
    });
  });

  describe("span lifecycle integration", () => {
    it("should properly handle manual span lifecycle", () => {
      const tracer = getLangWatchTracer("manual-lifecycle-test");

      // Create span manually
      const otelSpan = tracer.startSpan("manual-test-span");
      const langwatchSpan = createLangWatchSpan(otelSpan);

      expect(langwatchSpan.isRecording()).toBe(true);

      // Configure span
      langwatchSpan
        .setType("workflow")
        .setInput("Manual span input")
        .setAttribute("custom.attribute", "test-value")
        .addEvent("yoyoyoyo")
        .setOutput("Manual span output");

      // End span
      langwatchSpan.end();

      expect(langwatchSpan.isRecording()).toBe(false);

      // Verify span context
      const context = langwatchSpan.spanContext();
      expect(context.spanId).toBeDefined();
      expect(context.traceId).toBeDefined();
      expect(context.traceFlags).toBeDefined();
    });

    it("should support fluent chaining", async () => {
      const tracer = getLangWatchTracer("fluent-chaining-test");

      await tracer.withActiveSpan("fluent-span", async (span) => {
        const result = span
          .setType("llm")
          .setAttribute("step", 1)
          .setInput("Start")
          .setAttribute("step", 2)
          .addEvent("hehe")
          .setAttribute("step", 3)
          .setOutput("End")
          .setAttribute("step", 4);

        // Should return the same span for chaining
        expect(result).toBe(span);
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("llm");
      expect(span.attributes["step"]).toBe(4); // Last value wins
      expect(span.events).toHaveLength(1);

      const inputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(inputData.value).toBe("Start");

      const outputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string,
      );
      expect(outputData.value).toBe("End");
    });
  });

  describe("error handling and edge cases", () => {
    it("should handle invalid data gracefully", async () => {
      const tracer = getLangWatchTracer("invalid-data-test");

      await tracer.withActiveSpan("invalid-data-span", async (span) => {
        // Test with circular reference (should be handled gracefully)
        const circularData: any = { name: "test" };
        circularData.self = circularData;

        // This should not throw, but may result in truncated or sanitized data
        span.setType("tool").setInput("Valid input").setOutput("Valid output");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Should still have valid data
      const inputData = JSON.parse(
        span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string,
      );
      expect(inputData.value).toBe("Valid input");
    });

    it("should handle span status transitions correctly", async () => {
      const tracer = getLangWatchTracer("status-transitions-test");

      const span = tracer.startSpan("status-test-span");
      const langwatchSpan = createLangWatchSpan(span);

      // Initial state
      expect(langwatchSpan.isRecording()).toBe(true);

      // Configure span
      langwatchSpan
        .setType("workflow")
        .setInput("Testing status transitions")
        .setAttribute("test.phase", "initial");

      // Test multiple status updates (should be allowed)
      langwatchSpan.setStatus({ code: SpanStatusCode.OK }); // OK
      langwatchSpan.setAttribute("test.phase", "ok-status");

      // Update to error status
      langwatchSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Test error" }); // ERROR
      langwatchSpan.setAttribute("test.phase", "error-status");

      // Back to OK (should be allowed)
      langwatchSpan.setStatus({ code: SpanStatusCode.OK });
      langwatchSpan.setAttribute("test.phase", "final");

      langwatchSpan.setOutput("Status transitions completed");
      langwatchSpan.end();

      expect(langwatchSpan.isRecording()).toBe(false);

      // Test operations after span.end() - should be safe (no-ops)
      langwatchSpan.setAttribute("after.end", "should be ignored");
      langwatchSpan.setOutput("Should be ignored");

      // Force flush and verify
      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const exportedSpan = exportedSpans[0];
      if (!exportedSpan) {
        throw new Error("Expected span to be exported");
      }

      // Should have final OK status
      expect(exportedSpan.status.code).toBe(SpanStatusCode.OK); // OK
      expect(exportedSpan.attributes["test.phase"]).toBe("final");

      // Attributes set after end() should not be present
      expect("after.end" in exportedSpan.attributes).toBe(false);
    });
  });
});
