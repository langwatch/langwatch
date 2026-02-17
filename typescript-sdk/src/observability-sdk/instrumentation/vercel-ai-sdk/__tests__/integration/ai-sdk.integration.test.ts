import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { AISDKSpanProcessor } from "../..";
import { setupObservability } from "../../../../setup/node";
import { getLangWatchTracer } from "../../../../tracer";
import { NoOpLogger } from "../../../../../logger";

/**
 * Integration tests for Vercel AI SDK instrumentation with real OpenTelemetry setup.
 *
 * These tests verify:
 * - AI SDK span enrichment with LangWatch attributes
 * - Span creation and data flow through OpenTelemetry
 * - AISDKSpanProcessor integration with span pipeline
 * - Correct span type mapping for different AI SDK operations
 *
 * Note: These tests use mocked AI SDK spans to avoid requiring real API keys.
 * For end-to-end tests with real AI SDK calls, see the examples in the documentation.
 */

describe("AI SDK Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let aiSdkProcessor: AISDKSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    // Reset OpenTelemetry global state
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);
    aiSdkProcessor = new AISDKSpanProcessor();

    observabilityHandle = setupObservability({
      langwatch: "disabled",
      serviceName: "ai-sdk-integration-test",
      debug: { logger: new NoOpLogger() },
      spanProcessors: [aiSdkProcessor, spanProcessor],
      advanced: {
        throwOnSetupError: true,
        UNSAFE_forceOpenTelemetryReinitialization: true,
      },
      attributes: {
        "test.suite": "ai-sdk-integration",
        "test.component": "ai-sdk-instrumentation",
      },
    });
  });

  afterEach(async () => {
    await observabilityHandle?.shutdown();
    trace.disable();
    spanExporter.reset();
  });

  it("should enrich AI SDK streamText spans with LangWatch attributes", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    // Simulate AI SDK span creation
    const span = tracer.startSpan("ai.streamText", { root: true });
    span.setAttribute("ai.model.provider", "openai");
    span.setAttribute("ai.model.id", "gpt-4");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBe(1);
    const aiSpan = finishedSpans[0];

    // Verify AISDKSpanProcessor enriched the span
    expect(aiSpan?.name).toBe("ai.streamText");
    expect(aiSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(aiSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
    expect(aiSpan?.attributes["langwatch.ai_sdk.span_name"]).toBe("ai.streamText");
  });

  it("should enrich AI SDK generateText spans with correct type", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.generateText", { root: true });
    span.setAttribute("ai.model.provider", "anthropic");
    span.setAttribute("ai.model.id", "claude-3-5-sonnet-20241022");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const aiSpan = finishedSpans[0];
    expect(aiSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(aiSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should enrich AI SDK toolCall spans with tool type", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.toolCall", { root: true });
    span.setAttribute("ai.tool.name", "calculator");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const toolSpan = finishedSpans[0];
    expect(toolSpan?.attributes["langwatch.span.type"]).toBe("tool");
    expect(toolSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
    expect(toolSpan?.attributes["langwatch.ai_sdk.span_name"]).toBe("ai.toolCall");
  });

  it("should enrich AI SDK embed spans with component type", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.embed", { root: true });
    span.setAttribute("ai.model.provider", "openai");
    span.setAttribute("ai.model.id", "text-embedding-3-small");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const embedSpan = finishedSpans[0];
    expect(embedSpan?.attributes["langwatch.span.type"]).toBe("component");
    expect(embedSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should handle provider-level doGenerate spans", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.generateText.doGenerate", { root: true });
    span.setAttribute("ai.model.provider", "openai");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const providerSpan = finishedSpans[0];
    expect(providerSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(providerSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should handle provider-level doStream spans", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.streamText.doStream", { root: true });
    span.setAttribute("ai.model.provider", "anthropic");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const streamSpan = finishedSpans[0];
    expect(streamSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(streamSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should not modify non-AI SDK spans", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("http.request", { root: true });
    span.setAttribute("http.method", "POST");
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const httpSpan = finishedSpans[0];
    expect(httpSpan?.name).toBe("http.request");
    expect(httpSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBeUndefined();
    expect(httpSpan?.attributes["langwatch.span.type"]).toBeUndefined();
  });

  it("should enrich both parent and child AI SDK spans in a hierarchy", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    // Simulate AI SDK's hierarchical span creation
    await tracer.withActiveSpan("ai.streamText", { root: true }, async () => {
      // AI SDK creates child spans for tool calls
      const childSpan = tracer.startSpan("ai.toolCall");
      childSpan.end();
    });

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBe(2);

    const parentFinished = finishedSpans.find((s) => s.name === "ai.streamText");
    const childFinished = finishedSpans.find((s) => s.name === "ai.toolCall");

    // Verify both spans were enriched by AISDKSpanProcessor
    expect(parentFinished?.attributes["langwatch.span.type"]).toBe("llm");
    expect(parentFinished?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);

    expect(childFinished?.attributes["langwatch.span.type"]).toBe("tool");
    expect(childFinished?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);

    // Verify both spans are part of the same trace
    expect(childFinished?.spanContext().traceId).toBe(parentFinished?.spanContext().traceId);
  });

  it("should handle unknown AI SDK span types with llm default", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.futureOperation", { root: true });
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const futureSpan = finishedSpans[0];
    // Unknown AI SDK spans should default to llm type
    expect(futureSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(futureSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should handle multiple AI SDK operations in sequence", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    // Simulate multiple AI SDK calls
    const operations = [
      { name: "ai.generateText", expectedType: "llm" },
      { name: "ai.toolCall", expectedType: "tool" },
      { name: "ai.embed", expectedType: "component" },
      { name: "ai.streamText", expectedType: "llm" },
    ];

    for (const op of operations) {
      const span = tracer.startSpan(op.name, { root: true });
      span.end();
    }

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBe(operations.length);

    operations.forEach((op, index) => {
      const span = finishedSpans[index];
      expect(span?.name).toBe(op.name);
      expect(span?.attributes["langwatch.span.type"]).toBe(op.expectedType);
      expect(span?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
    });
  });

  it("should preserve existing span attributes when enriching", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.streamText", { root: true });

    // Add some attributes before processing
    span.setAttribute("ai.model.provider", "openai");
    span.setAttribute("ai.model.id", "gpt-4");
    span.setAttribute("ai.usage.prompt_tokens", 100);
    span.setAttribute("ai.usage.completion_tokens", 50);
    span.setAttribute("custom.attribute", "test-value");

    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const aiSpan = finishedSpans[0];

    // Verify LangWatch attributes were added
    expect(aiSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(aiSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);

    // Verify existing attributes were preserved
    expect(aiSpan?.attributes["ai.model.provider"]).toBe("openai");
    expect(aiSpan?.attributes["ai.model.id"]).toBe("gpt-4");
    expect(aiSpan?.attributes["ai.usage.prompt_tokens"]).toBe(100);
    expect(aiSpan?.attributes["ai.usage.completion_tokens"]).toBe(50);
    expect(aiSpan?.attributes["custom.attribute"]).toBe("test-value");
  });

  it("should handle embedMany operations", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const span = tracer.startSpan("ai.embedMany", { root: true });
    span.setAttribute("ai.model.provider", "openai");
    span.setAttribute("ai.embeddings.count", 10);
    span.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const embedSpan = finishedSpans[0];
    expect(embedSpan?.attributes["langwatch.span.type"]).toBe("component");
    expect(embedSpan?.attributes["langwatch.ai_sdk.instrumented"]).toBe(true);
  });

  it("should handle generateObject and streamObject operations", async () => {
    const tracer = getLangWatchTracer("ai-sdk-integration-test");

    const generateObjectSpan = tracer.startSpan("ai.generateObject", { root: true });
    generateObjectSpan.end();

    const streamObjectSpan = tracer.startSpan("ai.streamObject", { root: true });
    streamObjectSpan.end();

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const generateSpan = finishedSpans.find((s) => s.name === "ai.generateObject");
    const streamSpan = finishedSpans.find((s) => s.name === "ai.streamObject");

    expect(generateSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(streamSpan?.attributes["langwatch.span.type"]).toBe("llm");
  });
});

describe("AI SDK Processor Lifecycle", () => {
  it("should flush successfully without errors", async () => {
    const processor = new AISDKSpanProcessor();
    await expect(processor.forceFlush()).resolves.not.toThrow();
  });

  it("should shutdown successfully without errors", async () => {
    const processor = new AISDKSpanProcessor();
    await expect(processor.shutdown()).resolves.not.toThrow();
  });

  it("should handle multiple flush calls", async () => {
    const processor = new AISDKSpanProcessor();
    await processor.forceFlush();
    await processor.forceFlush();
    await expect(processor.forceFlush()).resolves.not.toThrow();
  });

  it("should handle shutdown after flush", async () => {
    const processor = new AISDKSpanProcessor();
    await processor.forceFlush();
    await expect(processor.shutdown()).resolves.not.toThrow();
  });
});
