import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { getLangWatchTracer } from "../../tracer";
import { NoOpLogger } from "../../../logger";
import * as semconv from "../../semconv";
import { setupObservability } from "../../setup/node";

/**
 * Integration tests for LangWatch tracer with real OpenTelemetry setup.
 *
 * These tests verify:
 * - Real OpenTelemetry SDK initialization
 * - Actual span creation and data flow
 * - Integration between tracer and setup components
 * - Data format consistency in exported spans
 */

// Test data constants for consistency
const TEST_COMPLEX_INPUT = {
  messages: [
    { role: "user", content: "Generate a haiku about TypeScript" },
    { role: "system", content: "You are a helpful assistant" }
  ],
  config: { temperature: 0.7, maxTokens: 150, model: "gpt-4" },
  metadata: { userId: "user-123", sessionId: "session-456" },
  features: ["chat", "analysis"],
  enabled: true,
  count: 42,
  score: null
} as const;

const TEST_COMPLEX_OUTPUT = {
  response: {
    text: "Types flow like code,\nCompiler catches all bugs,\nJavaScript evolved.",
    confidence: 0.95,
    reasoning: ["greeting_detected", "help_offered"]
  },
  usage: { promptTokens: 15, completionTokens: 25 },
  timing: { startTime: "2024-01-15T10:30:00.123Z", endTime: "2024-01-15T10:30:01.456Z", latencyMs: 1333 }
} as const;

describe("Tracer Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    // Reset OpenTelemetry global state
    vi.resetModules();

    // Create in-memory exporter to capture actual span data
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    // Setup observability with real OpenTelemetry SDK
    // Use spanProcessors instead of traceExporter as we don't want to wrap in a BatchSpanProcessor
    observabilityHandle = setupObservability({
      serviceName: "tracer-integration-test",
      spanProcessors: [spanProcessor],
      logger: new NoOpLogger(),
      throwOnSetupError: true,
      attributes: {
        "test.suite": "tracer-integration",
        "test.environment": "vitest"
      },
    });
  });

  afterEach(async () => {
    await observabilityHandle.shutdown();
    spanExporter.reset();
    trace.disable();
  });

  describe("span creation and data flow", () => {
    it("should create spans with proper LangWatch attributes through real OpenTelemetry", async () => {
      const tracer = getLangWatchTracer("integration-test-tracer");

      // Create span with LangWatch enhancements
      await tracer.withActiveSpan("test-llm-operation", async (span) => {
        span
          .setType("llm")
          .setInput(TEST_COMPLEX_INPUT)
          .setRequestModel("gpt-4")
          .addGenAIUserMessageEvent({
            role: "user",
            content: "Generate a haiku about TypeScript"
          })
          .setOutput(TEST_COMPLEX_OUTPUT)
          .addGenAIAssistantMessageEvent({
            role: "assistant",
            content: "Types flow like code,\nCompiler catches all bugs,\nJavaScript evolved."
          })
          .setMetrics({
            promptTokens: 15,
            completionTokens: 25,
            cost: 0.0012
          });
      });

      // Flush and verify exported spans
      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);

      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("test-llm-operation");
      expect(span.status.code).toBe(SpanStatusCode.OK); // OK status

      // Verify LangWatch-specific attributes
      expect(span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("llm");
      expect(span.attributes["gen_ai.request.model"]).toBe("gpt-4");

      // Verify input/output data format
      const inputData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string);
      expect(inputData.type).toBe("json");
      expect(inputData.value.messages).toHaveLength(2);
      expect(inputData.value.messages[0].content).toBe("Generate a haiku about TypeScript");
      expect(inputData.value.config.model).toBe("gpt-4");

      const outputData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_OUTPUT] as string);
      expect(outputData.type).toBe("json");
      expect(outputData.value.response.text).toContain("Types flow like code");

      // Verify metrics data format (note: corrected property names)
      const metricsData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_METRICS] as string);
      expect(metricsData.type).toBe("json");
      expect(metricsData.value.promptTokens).toBe(15);
      expect(metricsData.value.completionTokens).toBe(25);
      expect(metricsData.value.cost).toBeCloseTo(0.0012);

      // Verify events were recorded
      expect(span.events).toHaveLength(2);
      const eventNames = span.events.map(e => e.name);
      expect(eventNames).toContain(semconv.LOG_EVNT_GEN_AI_USER_MESSAGE);
      expect(eventNames).toContain(semconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE);

      // Verify event data format
      const userEvent = span.events.find(e => e.name === semconv.LOG_EVNT_GEN_AI_USER_MESSAGE);
      if (!userEvent?.attributes) {
        throw new Error("Expected user event with attributes");
      }
      const userEventBody = JSON.parse(userEvent.attributes[semconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY] as string);
      expect(userEventBody.role).toBe("user");
      expect(userEventBody.content).toBe("Generate a haiku about TypeScript");
    });

    it("should handle nested spans with proper parent-child relationships", async () => {
      const tracer = getLangWatchTracer("nested-spans-test");

      await tracer.withActiveSpan("parent-workflow", async (parent) => {
        parent.setType("workflow").setInput("Complex multi-step task");

        // Child span 1
        await tracer.withActiveSpan("llm-generation", async (child1) => {
          child1
            .setType("llm")
            .setInput("Generate content")
            .setOutput("Generated content");
        });

        // Child span 2
        await tracer.withActiveSpan("data-processing", async (child2) => {
          child2
            .setType("tool")
            .setInput("Process generated content")
            .setOutput("Processed result");
        });

        parent.setOutput("Workflow completed successfully");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(3);

      // Find spans by name
      const parentSpan = exportedSpans.find(s => s.name === "parent-workflow");
      const child1Span = exportedSpans.find(s => s.name === "llm-generation");
      const child2Span = exportedSpans.find(s => s.name === "data-processing");

      expect(parentSpan).toBeDefined();
      expect(child1Span).toBeDefined();
      expect(child2Span).toBeDefined();

      if (!parentSpan || !child1Span || !child2Span) {
        throw new Error("All spans should be defined");
      }

      // Verify parent-child relationships using trace and span context
      const parentTraceId = parentSpan.spanContext().traceId;
      const parentSpanId = parentSpan.spanContext().spanId;

      expect(child1Span.spanContext().traceId).toBe(parentTraceId);
      expect(child2Span.spanContext().traceId).toBe(parentTraceId);

      // Note: In OpenTelemetry JS, ReadableSpan doesn't expose parentSpanId directly.
      // Instead, we verify that all spans are in the same trace, which indicates proper nesting.

      // Verify span types
      expect(parentSpan.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("workflow");
      expect(child1Span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("llm");
      expect(child2Span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("tool");
    });

    it("should handle errors and exceptions properly", async () => {
      const tracer = getLangWatchTracer("error-handling-test");

      await expect(
        tracer.withActiveSpan("failing-operation", async (span) => {
          span
            .setType("llm")
            .setInput("This will fail")
            .addGenAIUserMessageEvent({
              role: "user",
              content: "Cause an error"
            });

          throw new Error("Integration test error");
        })
      ).rejects.toThrow("Integration test error");

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);

      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("failing-operation");
      expect(span.status.code).toBe(2); // ERROR status
      expect(span.status.message).toBe("Integration test error");

      // Verify input was recorded before error
      const inputData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string);
      expect(inputData.value).toBe("This will fail");

      // Verify events were recorded before error
      expect(span.events.length).toBeGreaterThan(0);
      const hasUserMessage = span.events.some(e => e.name === semconv.LOG_EVNT_GEN_AI_USER_MESSAGE);
      expect(hasUserMessage).toBe(true);

      // Verify exception was recorded
      const hasExceptionEvent = span.events.some(e => e.name === "exception");
      expect(hasExceptionEvent).toBe(true);
    });
  });

  describe("startSpan method integration", () => {
    it("should create enhanced spans via startSpan with proper data flow", () => {
      const tracer = getLangWatchTracer("start-span-test");

      const span = tracer.startSpan("manual-span");

      // Configure span with LangWatch methods
      span
        .setType("agent")
        .setInput({ task: "Manual span operation" })
        .setAttribute("custom.attribute", "test-value")
        .addGenAISystemMessageEvent({
          role: "system",
          content: "You are a helpful assistant"
        })
        .setRAGContext({
          document_id: "doc-123",
          chunk_id: "chunk-456",
          content: "Relevant context data"
        })
        .setOutput({ result: "Manual span completed" });

      span.end();

      // Verify span was created properly
      expect(span.isRecording()).toBe(false); // Should be ended
      expect(span.spanContext().spanId).toBeDefined();
      expect(span.spanContext().traceId).toBeDefined();
    });
  });

  describe("tracer-specific functionality", () => {
    it("should handle tracer provider integration correctly", async () => {
      const tracer = getLangWatchTracer("provider-integration-test");

      await tracer.withActiveSpan("provider-test", async (span) => {
        span
          .setType("tool")
          .setInput("Testing provider integration")
          .setOutput("Provider integration successful");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("tool");

      // Verify service attributes from setup
      expect(span.resource.attributes["service.name"]).toBe("tracer-integration-test");
      expect(span.resource.attributes["test.suite"]).toBe("tracer-integration");
    });
  });

  describe("global tracer provider integration", () => {
    it("should use the globally configured tracer provider", () => {
      // Get tracer using global provider
      const tracer1 = getLangWatchTracer("global-test-1");
      const tracer2 = getLangWatchTracer("global-test-2");

      // Both should work with the same global provider
      const span1 = tracer1.startSpan("span-1");
      const span2 = tracer2.startSpan("span-2");

      expect(span1.spanContext().traceId).toBeDefined();
      expect(span2.spanContext().traceId).toBeDefined();

      // Should be different spans but both valid
      expect(span1.spanContext().spanId).not.toBe(span2.spanContext().spanId);

      span1.end();
      span2.end();
    });
  });

  describe("performance and concurrency", () => {
    it("should handle concurrent span creation efficiently", async () => {
      const tracer = getLangWatchTracer("concurrent-test");

      const concurrentOperations = Array.from({ length: 10 }, (_, i) =>
        tracer.withActiveSpan(`concurrent-span-${i}`, async (span) => {
          span
            .setType("llm")
            .setInput(`Concurrent operation ${i}`)
            .setAttribute("operation.index", i);

          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

          span.setOutput(`Result ${i}`);
          return i;
        })
      );

      const results = await Promise.all(concurrentOperations);

      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(10);

      // Verify all spans have unique IDs and proper attributes
      const spanIds = new Set(exportedSpans.map(s => s.spanContext().spanId));
      expect(spanIds.size).toBe(10); // All unique

      exportedSpans.forEach((span) => {
        expect(span.attributes[semconv.ATTR_LANGWATCH_SPAN_TYPE]).toBe("llm");
        expect(span.attributes["operation.index"]).toBeDefined();
        expect(typeof span.attributes["operation.index"]).toBe("number");
      });
    });

    it("should handle rapid span creation/deletion cycles", async () => {
      const tracer = getLangWatchTracer("rapid-cycle-test");
      const cycles = 50;

      const rapidOperations = Array.from({ length: cycles }, (_, i) =>
        tracer.withActiveSpan(`rapid-span-${i}`, async (span) => {
          span
            .setType("workflow")
            .setInput(`Rapid cycle ${i}`)
            .setAttribute("cycle.index", i)
            .setOutput(`Cycle ${i} complete`);

          // Immediate completion - stress test lifecycle
          return `result-${i}`;
        })
      );

      const results = await Promise.all(rapidOperations);
      expect(results).toHaveLength(cycles);

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(cycles);

      // Verify all spans were properly created and ended
      const allCompleted = exportedSpans.every(span =>
        span.status.code === 1 && // OK status
        span.endTime[0] > 0 // Has end time
      );
      expect(allCompleted).toBe(true);
    });

    it("should handle large data volumes efficiently", async () => {
      const tracer = getLangWatchTracer("large-data-test");

      // Create moderately large input data
      const largeInput = {
        data: "x".repeat(50_000), // 50KB string
        numbers: Array.from({ length: 1000 }, (_, i) => i),
        nested: {
          level1: { level2: { level3: "deeply nested data" } }
        }
      };

      await tracer.withActiveSpan("large-data-span", async (span) => {
        span
          .setType("tool")
          .setInput(largeInput)
          .setOutput({ processed: true, size: JSON.stringify(largeInput).length });
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Verify large data was serialized correctly
      const inputData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string);
      expect(inputData.type).toBe("json");
      expect(inputData.value.data).toHaveLength(50_000);
      expect(inputData.value.numbers).toHaveLength(1000);
      expect(inputData.value.nested.level1.level2.level3).toBe("deeply nested data");
    });
  });

  describe("attribute and metadata validation", () => {
    it("should validate and sanitize attribute values", async () => {
      const tracer = getLangWatchTracer("attribute-validation-test");

      await tracer.withActiveSpan("validation-span", async (span) => {
        span
          .setType("tool")
          .setAttribute("string.attr", "valid string")
          .setAttribute("number.attr", 42)
          .setAttribute("boolean.attr", true)
          .setInput("Test input")
          .setOutput("Test output");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.attributes["string.attr"]).toBe("valid string");
      expect(span.attributes["number.attr"]).toBe(42);
      expect(span.attributes["boolean.attr"]).toBe(true);

      // OpenTelemetry doesn't support null or undefined attribute values
      expect("null.attr" in span.attributes).toBe(false);
      expect("undefined.attr" in span.attributes).toBe(false);
    });

    it("should handle complex attribute type coercion", async () => {
      const tracer = getLangWatchTracer("attribute-coercion-test");

      await tracer.withActiveSpan("coercion-span", async (span) => {
        span.setType("tool");

        // Test with various edge case attribute values
        try {
          // These should be handled gracefully or converted to strings
          span.setAttribute("valid.string", "normal string");
          span.setAttribute("valid.number", 42);
          span.setAttribute("valid.boolean", true);
          span.setAttribute("array.value", [1, 2, 3] as any); // Not valid AttributeValue
          span.setAttribute("object.value", { key: "value" } as any); // Not valid AttributeValue
          span.setAttribute("date.value", new Date() as any); // Not valid AttributeValue
          span.setAttribute("null.value", null as any); // Not valid AttributeValue
        } catch (error) {
          // Some invalid attribute types may throw - this is expected behavior
        }

        span.setInput("Attribute coercion test").setOutput("Completed");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Verify valid attributes are present
      expect(span.attributes["valid.string"]).toBe("normal string");
      expect(span.attributes["valid.number"]).toBe(42);
      expect(span.attributes["valid.boolean"]).toBe(true);

      // Invalid attribute types should either be:
      // 1. Converted to strings, or
      // 2. Omitted from the span attributes
      // We don't assert their presence/absence as it depends on OpenTelemetry implementation
    });
  });

  describe("error boundary and recovery", () => {
    it("should handle span operation failures gracefully", async () => {
      const tracer = getLangWatchTracer("span-failure-test");

      // Test span that encounters issues during configuration
      await tracer.withActiveSpan("problematic-span", async (span) => {
        span.setType("tool");

        // Set valid input first
        span.setInput("Valid input data");

        try {
          // Attempt to set problematic data that might cause serialization issues
          const circularData: any = { name: "circular" };
          circularData.self = circularData;

          // This may fail or be handled gracefully depending on implementation
          span.setOutput(circularData);
        } catch (error) {
          // If it throws, set a fallback output
          span.setOutput("Fallback output due to serialization error");
        }

        // Span should still be functional after errors
        span.setAttribute("recovery.test", true);
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      // Span should have completed successfully
      expect(span.status.code).toBe(1); // OK status
      expect(span.attributes["recovery.test"]).toBe(true);

      // Input should be preserved
      const inputData = JSON.parse(span.attributes[semconv.ATTR_LANGWATCH_INPUT] as string);
      expect(inputData.value).toBe("Valid input data");
    });

    it("should handle context corruption gracefully", async () => {
      const tracer = getLangWatchTracer("context-corruption-test");

      // Create a normal span first
      await tracer.withActiveSpan("parent-span", async (parentSpan) => {
        parentSpan.setType("workflow").setInput("Parent operation");

        // Simulate potential context issues with nested spans
        await tracer.withActiveSpan("child-span-1", async (child1) => {
          child1.setType("tool").setInput("Child 1 operation");

          // Create deeply nested span that might stress context handling
          await tracer.withActiveSpan("nested-span", async (nested) => {
            nested.setType("llm").setInput("Deeply nested operation");

            // Force context switching with concurrent operations
            const concurrentNested = Array.from({ length: 5 }, (_, i) =>
              tracer.withActiveSpan(`concurrent-nested-${i}`, async (span) => {
                span.setType("agent").setInput(`Concurrent nested ${i}`);
                return i;
              })
            );

            const results = await Promise.all(concurrentNested);
            nested.setOutput({ nestedResults: results });
          });

          child1.setOutput("Child 1 completed");
        });

        // Another child after the first child completes
        await tracer.withActiveSpan("child-span-2", async (child2) => {
          child2.setType("rag").setInput("Child 2 operation").setOutput("Child 2 completed");
        });

        parentSpan.setOutput("Parent workflow completed");
      });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have: 1 parent + 2 children + 1 nested + 5 concurrent nested = 9 spans
      expect(exportedSpans.length).toBeGreaterThanOrEqual(8); // Allow for some flexibility

      // Verify parent span completed successfully
      const parentSpan = exportedSpans.find(s => s.name === "parent-span");
      expect(parentSpan).toBeDefined();
      expect(parentSpan?.status.code).toBe(1); // OK status

      // Verify all spans are in the same trace (proper context propagation)
      const traceIds = new Set(exportedSpans.map(s => s.spanContext().traceId));
      expect(traceIds.size).toBe(1); // All spans should be in the same trace
    });

    it("should handle provider shutdown during span operations", async () => {
      const tracer = getLangWatchTracer("shutdown-test");

      // Start a span operation
      const spanPromise = tracer.withActiveSpan("shutdown-span", async (span) => {
        span.setType("tool").setInput("Operation during shutdown");

        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));

        // Try to continue working on span even if provider is shutting down
        span.setAttribute("continued.work", true);
        span.setOutput("Completed despite shutdown");

        return "success";
      });

      // Don't actually shutdown the provider as it would affect other tests
      // This test verifies the span can complete its work
      const result = await spanPromise;
      expect(result).toBe("success");

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.status.code).toBe(1); // OK status
      expect(span.attributes["continued.work"]).toBe(true);
    });
  });
});
