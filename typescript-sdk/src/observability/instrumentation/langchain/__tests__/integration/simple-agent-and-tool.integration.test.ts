import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { LangWatchCallbackHandler } from "../..";
import { setupObservability } from "../../../../setup/node";
import { getLangWatchTracer } from "../../../../tracer";
import { NoOpLogger } from "../../../../../logger";

/**
 * Integration tests for LangChain instrumentation with real OpenTelemetry setup.
 *
 * These tests verify:
 * - Real LangChain integration with LangWatch tracing
 * - Actual span creation and data flow through OpenTelemetry
 * - Integration between LangChain callbacks and LangWatch spans
 * - Tool calling and agent execution tracing
 */

describe("LangChain Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    // Reset OpenTelemetry global state
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    observabilityHandle = setupObservability({
      serviceName: "langchain-integration-test",
      logger: new NoOpLogger(),
      throwOnSetupError: true,
      spanProcessors: [spanProcessor],
      UNSAFE_forceOpenTelemetryReinitialization: true,
      attributes: {
        "test.suite": "langchain-integration",
        "test.component": "langchain-callbacks",
      },
    });
  });

  afterEach(async () => {
    await observabilityHandle?.shutdown();
    trace.disable();
    spanExporter.reset();
  });

  it("should trace a simple LLM question/response interaction", async () => {
    const tracer = getLangWatchTracer("langchain-integration-test");

    await tracer.withActiveSpan(
      "simple question/response",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-4o-mini",
          temperature: 0,
        });

        const result = await llm.invoke(
          [{ role: "user", content: "Say hello to Bob" }],
          { callbacks: [new LangWatchCallbackHandler()] },
        );

        expect(result.content).toContain("Bob");
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify span structure
    expect(finishedSpans.length).toBeGreaterThan(0);

    // Find the LLM span
    const llmSpan = finishedSpans.find(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpan).toBeDefined();
    expect(llmSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(llmSpan?.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
  });

  it("should trace tool calling and agent execution", async () => {
    const tools = [
      new DynamicTool({
        name: "get_current_time",
        description: "Returns the current time in ISO-8601 format.",
        func: async () => new Date().toISOString(),
      }),
      new DynamicTool({
        name: "multiply",
        description: 'Multiply two numbers, provide input like "a,b".',
        func: async (input: string) => {
          const [a, b] = input.split(",").map(Number);
          if (a === undefined || b === undefined) {
            throw new Error("Invalid input");
          }
          return String(a * b);
        },
      }),
    ];

    const tracer = getLangWatchTracer("langchain-integration-test");

    await tracer.withActiveSpan(
      "tool calling test",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-4o-mini",
          temperature: 0,
        });

        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "You are a helpful assistant"],
          ["placeholder", "{chat_history}"],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({
          llm,
          tools,
          prompt,
        });

        const agentExecutor = new AgentExecutor({
          agent,
          tools,
        });

        const tracingCallback = new LangWatchCallbackHandler();
        const result = await agentExecutor.invoke(
          { input: "What is 12 times 8?" },
          { callbacks: [tracingCallback] },
        );

        expect(result.output).toContain("96");
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify multiple spans were created for the agent execution
    expect(finishedSpans.length).toBeGreaterThan(1);

    // Check for tool execution spans
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);
  });

  it("should handle multiple consecutive LLM calls with context grouping", async () => {
    const tracer = getLangWatchTracer("langchain-integration-test");

    await tracer.withActiveSpan(
      "context grouping test",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-4o-mini",
          temperature: 0,
        });

        const tracingCallback = new LangWatchCallbackHandler();

        const result1 = await llm.invoke(
          [{ role: "user", content: "Say hello to Alice" }],
          { callbacks: [tracingCallback] },
        );

        const result2 = await llm.invoke(
          [{ role: "user", content: "Say hello to Bob" }],
          { callbacks: [tracingCallback] },
        );

        expect(result1.content).toContain("Alice");
        expect(result2.content).toContain("Bob");
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify multiple LLM spans were created
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBe(2);

    // Verify all spans share the same trace context
    const traceIds = new Set(
      llmSpans.map((span) => span.spanContext().traceId),
    );
    expect(traceIds.size).toBe(1);
  });

  it("should properly handle LLM errors and record exceptions", async () => {
    const tracer = getLangWatchTracer("langchain-integration-test");

    await tracer.withActiveSpan(
      "error handling test",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "invalid-model",
          temperature: 0,
          openAIApiKey: "invalid-key", // This will cause an error
        });

        const tracingCallback = new LangWatchCallbackHandler();

        await expect(
          llm.invoke([{ role: "user", content: "This should fail" }], {
            callbacks: [tracingCallback],
          }),
        ).rejects.toThrow();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify error span was created
    const errorSpans = finishedSpans.filter(
      (span) => span.status.code === 2, // ERROR status code
    );
    expect(errorSpans.length).toBeGreaterThan(0);
  });
});
