/**
 * End-to-end tests for content parsing and message extraction
 *
 * Basic sanity checks that LangWatch correctly parses content from different input types.
 * Focused on essential message and content format validation.
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

describe("Content Parsing E2E", () => {
  const setup = setupE2ETest();

  it("should parse and extract chat messages correctly", async () => {
    const tracer = createTestTracer("chat-messages");
    const testIds = generateTestIds();
    let traceId: string;

    const chatInput = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, how are you?" }
      ],
      model: "gpt-4o-mini"
    };

    const chatOutput = {
      choices: [{
        message: {
          role: "assistant",
          content: "Hello! I'm doing well, thank you for asking."
        }
      }],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 }
    };

    await tracer.withActiveSpan("chat-conversation", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "chat-messages",
      });

      span.setType("llm");
      span.setInput(chatInput);

      // Add message events
      span.addGenAISystemMessageEvent({ content: chatInput.messages[0]?.content || "" });
      span.addGenAIUserMessageEvent({ role: "user", content: chatInput.messages[1]?.content || "" });

      await delay(50);

      span.setOutput(chatOutput);
      span.setMetrics({
        promptTokens: chatOutput.usage.prompt_tokens,
        completionTokens: chatOutput.usage.completion_tokens,
      });

      span.addGenAIAssistantMessageEvent({
        role: "assistant",
        content: chatOutput.choices[0]?.message.content || ""
      });

      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("chat-conversation");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "chat-messages");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
    expect(span!.metrics).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle RAG contexts", async () => {
    const tracer = createTestTracer("rag-contexts");
    const testIds = generateTestIds();
    let traceId: string;

    const ragInput = {
      query: "What are the benefits of renewable energy?",
      model: "gpt-4o-mini"
    };

    const ragContexts = [
      { content: "Solar energy reduces carbon emissions.", document_id: "doc_solar_001", chunk_id: "chunk_1" },
      { content: "Wind power is cost-effective.", document_id: "doc_wind_003", chunk_id: "chunk_2" }
    ];

    const ragOutput = {
      answer: "Renewable energy offers reduced emissions and cost savings.",
      sources_used: ["doc_solar_001", "doc_wind_003"]
    };

    await tracer.withActiveSpan("rag-query", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "rag-contexts",
      });

      span.setType("rag");
      span.setInput(ragInput);
      span.setRAGContexts(ragContexts);

      await delay(50);

      span.setOutput(ragOutput);
      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("rag-query");
    expect(span!.type).toBe("rag");
    expectSpanAttribute(span!, "test.scenario", "rag-contexts");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
  }, E2E_CONFIG.timeout);

  it("should handle function calls", async () => {
    const tracer = createTestTracer("function-calls");
    const testIds = generateTestIds();
    let traceId: string;

    const functionInput = {
      messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
      functions: [{ name: "get_weather", description: "Get weather for a city" }],
      model: "gpt-4o-mini"
    };

    const functionOutput = {
      message: { role: "assistant", content: "It's sunny in Tokyo, 22°C." },
      function_calls: [{ name: "get_weather", result: { temperature: 22, condition: "sunny" } }]
    };

    await tracer.withActiveSpan("function-calling", async (span) => {
      traceId = getTraceIdFromSpan(span);

      span.setAttributes({
        [semconv.ATTR_LANGWATCH_CUSTOMER_ID]: testIds.userId,
        [semconv.ATTR_LANGWATCH_THREAD_ID]: testIds.threadId,
        "test.scenario": "function-calls",
      });

      span.setType("llm");
      span.setInput(functionInput);

      await delay(50);

      span.setOutput(functionOutput);
      span.setStatus({ code: SpanStatusCode.OK });
    });

    // Verify trace ingestion
    const trace = await expectTraceToBeIngested(setup.client, traceId!, 1);
    const span = trace.spans?.[0];

    expect(span).toBeDefined();
    expect(span!.name).toBe("function-calling");
    expect(span!.type).toBe("llm");
    expectSpanAttribute(span!, "test.scenario", "function-calls");
    expect(span!.input).toBeTruthy();
    expect(span!.output).toBeTruthy();
  }, E2E_CONFIG.timeout);
});
