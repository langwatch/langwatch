/**
 * End-to-end tests for different tracer provider configurations
 *
 * Basic sanity checks that LangWatch works with various OpenTelemetry setups.
 * Focused on essential provider configuration validation.
 */

import { describe, it, expect } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  setupE2ETest,
  createTestTracer,
  generateTestIds,
  delay,
  E2E_CONFIG,
  expectTraceToBeIngested,
  getTraceIdFromSpan,
  expectSpanAttribute,
} from "./e2e-utils";
import * as semconv from "../../semconv";

describe("Tracer Provider Configuration E2E", () => {
  const setup = setupE2ETest();

  it("should work with standard tracer provider", async () => {
    const tracer = createTestTracer("standard-provider");
    const testIds = generateTestIds();
    let traceId: string;

    await tracer.withActiveSpan("standard-provider-test", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "standard-provider",
        "provider.type": "standard",
      });

      span.setType("llm");
      span.setInput({ message: "Test with standard provider" });

      await delay(50);

      span.setOutput({ response: "Response from standard provider test" });
      span.setMetrics({ promptTokens: 20, completionTokens: 15 });
      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("standard-provider-test");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "standard-provider");
    expectSpanAttribute(span!, "provider.type", "standard");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
    expect(span!.metrics).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle multiple tracer instances", async () => {
    const tracer1 = createTestTracer("service-1");
    const tracer2 = createTestTracer("service-2");
    const testIds = generateTestIds();
    let traceId1: string;
    let traceId2: string;

    // Run operations with different tracers
    await tracer1.withActiveSpan("multi-tracer-op-1", async (span) => {
      traceId1 = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "multi-tracer",
        "tracer.service": "service-1",
      });

      span.setType("llm");
      await delay(25);
      span.setStatus({ code: SpanStatusCode.OK });
    });

    await tracer2.withActiveSpan("multi-tracer-op-2", async (span) => {
      traceId2 = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "multi-tracer",
        "tracer.service": "service-2",
      });

      span.setType("rag");
      await delay(25);
      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify both traces
    const trace1 = await expectTraceToBeIngested(setup.client, traceId1!, 1);
    const trace2 = await expectTraceToBeIngested(setup.client, traceId2!, 1);

    const span1 = trace1.spans?.[0];
    const span2 = trace2.spans?.[0];

    expect(span1).toBeDefined();
    expect(span1!.name).toBe("multi-tracer-op-1");
    expect(span1!.type).toBe("llm");
    expectSpanAttribute(span1!, "tracer.service", "service-1");

    expect(span2).toBeDefined();
    expect(span2!.name).toBe("multi-tracer-op-2");
    expect(span2!.type).toBe("rag");
    expectSpanAttribute(span2!, "tracer.service", "service-2");
  }, E2E_CONFIG.timeout);

  it("should handle nested spans with context", async () => {
    const tracer = createTestTracer("context-propagation");
    const testIds = generateTestIds();
    let traceId: string;

    await tracer.withActiveSpan("parent-context-test", async (parentSpan) => {
      traceId = getTraceIdFromSpan(parentSpan);

      parentSpan.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "context-propagation",
        "span.level": "parent",
      });

      parentSpan.setType("workflow");

      // Nested operation that should maintain parent context
      await tracer.withActiveSpan("child-context-test", async (child) => {
        child.setAttributes({
          "span.level": "child",
        });

        child.setType("llm");
        await delay(25);
        child.setStatus({ code: SpanStatusCode.OK });
      });

      parentSpan.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify nested spans
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 2);

    const parentSpan = trace.spans?.find((s) => s.name === "parent-context-test");
    const childSpan = trace.spans?.find((s) => s.name === "child-context-test");

    expect(parentSpan).toBeTruthy();
    expect(childSpan).toBeTruthy();
    expect(parentSpan!.type).toBe("workflow");
    expect(childSpan!.type).toBe("llm");
    expectSpanAttribute(parentSpan!, "span.level", "parent");
    expectSpanAttribute(childSpan!, "span.level", "child");

    // Verify both spans are in the same trace
    expect(parentSpan!.trace_id).toBe(traceId!);
    expect(childSpan!.trace_id).toBe(traceId!);
  }, E2E_CONFIG.timeout);
});
