/**
 * End-to-end tests for basic span ingestion
 *
 * These tests validate that spans are correctly created, configured, and sent to LangWatch.
 * Focused on sanity checks for common metadata, name, type, etc.
 */

import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import * as semconv from "../../semconv";
import {
  createTestTracer,
  delay,
  E2E_CONFIG,
  expectSpanAttribute,
  expectSpanAttributeWithTrace,
  expectTraceToBeIngested,
  generateTestIds,
  getTraceIdFromSpan,
  setupE2ETest,
} from "./e2e-utils";

describe("Basic Span Ingestion E2E", () => {
  const setup = setupE2ETest();

  /**
   * Helper function to create a span with common test attributes
   */
  const createSpanWithCommonAttributes = (
    span: any,
    testIds: ReturnType<typeof generateTestIds>,
    scenario: string,
  ) => {
    span.setAttributes({
      [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
      [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
      "test.scenario": scenario,
    });
  };

  it(
    "creates and send a simple span successfully",
    async () => {
      const tracer = createTestTracer("simple-span");
      const testIds = generateTestIds();
      let traceId: string;

      await tracer.withActiveSpan("simple-operation", async (span) => {
        traceId = getTraceIdFromSpan(span);
        createSpanWithCommonAttributes(span, testIds, "simple-span");

        span.setType("llm");
        span.setInput({ message: "Hello world" });
        span.setOutput({ response: "Hello back!" });
        span.setMetrics({ promptTokens: 10, completionTokens: 5 });

        await delay(50);
        span.setStatus({ code: SpanStatusCode.OK });
      });

      // Verify trace ingestion
      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
      const span = trace.spans?.[0];

      expect(span).toBeTruthy();
      if (!span) throw new Error("Span is undefined");

      expect((span as any).name).toBe("simple-operation");
      expect((span as any).type).toBe("llm");

      // Use the new helper that checks both span params and trace metadata
      expectSpanAttributeWithTrace(
        trace,
        span,
        semconv.ATTR_LANGWATCH_CUSTOMER_ID,
        testIds.userId,
      );
      expectSpanAttributeWithTrace(
        trace,
        span,
        semconv.ATTR_LANGWATCH_THREAD_ID,
        testIds.threadId,
      );
      expectSpanAttribute(span, "test.scenario", "simple-span");

      // Verify input/output exist
      expect((span as any).input).toBeTruthy();
      expect((span as any).output).toBeTruthy();
      expect((span as any).metrics).toBeTruthy();
    },
    E2E_CONFIG.timeout,
  );

  it(
    "handles nested spans",
    async () => {
      const tracer = createTestTracer("nested-spans");
      const testIds = generateTestIds();
      let traceId: string;

      await tracer.withActiveSpan("parent-operation", async (parentSpan) => {
        traceId = getTraceIdFromSpan(parentSpan);
        createSpanWithCommonAttributes(parentSpan, testIds, "nested-spans");

        parentSpan.setType("workflow");

        await tracer.withActiveSpan("child-operation", async (childSpan) => {
          childSpan.setType("llm");
          childSpan.setInput({ query: "Child query" });
          await delay(25);
        });
      });

      // Verify all spans were ingested (will wait for exactly 2 spans)
      const trace = await expectTraceToBeIngested(setup.client, traceId!, 2);

      const parentSpanData = trace.spans?.find(
        (s) => s.name === "parent-operation",
      );
      const childSpanData = trace.spans?.find(
        (s) => s.name === "child-operation",
      );

      expect(parentSpanData).toBeTruthy();
      expect(childSpanData).toBeTruthy();
      expect(parentSpanData!.type).toBe("workflow");
      expect(childSpanData!.type).toBe("llm");
    },
    E2E_CONFIG.timeout,
  );

  it(
    "handles error scenarios",
    async () => {
      const tracer = createTestTracer("error-handling");
      const testIds = generateTestIds();
      let traceId: string;

      try {
        await tracer.withActiveSpan("failing-operation", async (span) => {
          traceId = getTraceIdFromSpan(span);
          createSpanWithCommonAttributes(span, testIds, "error-handling");

          span.setType("llm");
          const error = new Error("Test error");
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });

          throw error;
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      // Verify error span ingestion
      const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
      const span = trace.spans?.[0];

      expect(span).toBeDefined();
      expect(span!.name).toBe("failing-operation");
      expect(span!.type).toBe("llm");
      expect(span!.error?.has_error).toBe(true);
      expectSpanAttribute(span!, "test.scenario", "error-handling");
    },
    E2E_CONFIG.timeout,
  );
});
