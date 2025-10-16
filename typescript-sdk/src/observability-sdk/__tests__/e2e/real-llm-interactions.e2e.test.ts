/**
 * End-to-end tests with real LLM interactions
 *
 * Basic sanity checks for LLM interaction flows.
 * Focused on essential interaction patterns and metadata validation.
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

describe("Real LLM Interactions E2E", () => {
  const setup = setupE2ETest();

  it("should handle chat completion flow", async () => {
    const tracer = createTestTracer("chat-completion");
    const testIds = generateTestIds();
    let traceId: string | undefined;

    const chatRequest = {
      model: "gpt-5",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, how are you?" }
      ],
      temperature: 0.7
    };

    const chatResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      choices: [{
        message: {
          role: "assistant",
          content: "Hello! I'm doing well, thank you for asking."
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 15,
        total_tokens: 35
      }
    };

    await tracer.withActiveSpan("chat-completion", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "chat-completion",
      });

      span.setType("llm");
      span.setInput(chatRequest);

      await delay(100);

      span.setOutput(chatResponse);
      span.setMetrics({
        promptTokens: chatResponse.usage.prompt_tokens,
        completionTokens: chatResponse.usage.completion_tokens,
      });

      span.setStatus({ code: SpanStatusCode.OK });
    });

    if (!traceId) {
      throw new Error("Failed to get trace ID from span");
    }

    console.log(`🔍 Attempting trace lookup with ID: ${traceId}`);

    // Try the exact trace ID lookup with more detailed error info
    const trace = await expectTraceToBeIngested(setup.client, traceId, 1);

    // If we get here, the test passed!
    const span = trace.spans?.[0];
    expect(span).toBeDefined();
    expect(span!.name).toBe("chat-completion");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "chat-completion");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
    expect(span!.metrics).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle streaming responses", async () => {
    const tracer = createTestTracer("streaming");
    const testIds = generateTestIds();
    let traceId: string;

    const streamRequest = {
      model: "gpt-5",
      messages: [{ role: "user", content: "Write a haiku about AI" }],
      stream: true
    };

    const finalResponse = {
      content: "Silicon minds think,\nPatterns emerge from vast data,\nFuture unfolds now.",
      chunks_received: 3,
      streaming_duration_ms: 150
    };

    await tracer.withActiveSpan("streaming-generation", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "streaming",
        "gen_ai.request.model": streamRequest.model,
        "langwatch.gen_ai.streaming": true,
      });

      span.setType("llm");
      span.setInput(streamRequest);

      await delay(100);

      span.setOutput(finalResponse);
      span.setMetrics({
        promptTokens: 15,
        completionTokens: 25,
      });

      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("streaming-generation");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "streaming");
    expectSpanAttribute(span!, "langwatch.gen_ai.streaming", true);
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle function calling", async () => {
    const tracer = createTestTracer("function-calling");
    const testIds = generateTestIds();
    let traceId: string;

    const functionRequest = {
      model: "gpt-5",
      messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
      functions: [{ name: "get_weather", description: "Get weather" }],
    };

    const finalResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      choices: [{
        message: {
          role: "assistant",
          content: "The weather in Tokyo is sunny with 22°C."
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 95,
        completion_tokens: 45,
        total_tokens: 140
      }
    };

    await tracer.withActiveSpan("function-calling-workflow", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "function-calling",
        "gen_ai.request.model": functionRequest.model,
      });

      span.setType("llm");
      span.setInput(functionRequest);

      await delay(100);

      span.setOutput(finalResponse);
      span.setMetrics({
        promptTokens: finalResponse.usage.prompt_tokens,
        completionTokens: finalResponse.usage.completion_tokens,
      });

      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("function-calling-workflow");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "function-calling");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle error scenarios", async () => {
    const tracer = createTestTracer("llm-error");
    const testIds = generateTestIds();
    let traceId: string;

    const errorRequest = {
      model: "gpt-5",
      messages: [{ role: "user", content: "x".repeat(5000) }], // Too long
    };

    const errorResponse = {
      error: {
        type: "invalid_request_error",
        code: "context_length_exceeded",
        message: "Context length exceeded"
      }
    };

    await tracer.withActiveSpan("llm-error-scenario", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "llm-error",
        "gen_ai.request.model": errorRequest.model,
      });

      span.setType("llm");
      span.setInput(errorRequest);

      await delay(50);

      span.setOutput(errorResponse);

      // Record the error
      const error = new Error(`${errorResponse.error.type}: ${errorResponse.error.message}`);
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorResponse.error.message,
      });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("llm-error-scenario");
    expect(span!.type).toBe("llm");
    expect(span!.error?.has_error).toBe(true);
    expectSpanAttribute(span!, "test.scenario", "llm-error");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
  }, E2E_CONFIG.timeout);
});
