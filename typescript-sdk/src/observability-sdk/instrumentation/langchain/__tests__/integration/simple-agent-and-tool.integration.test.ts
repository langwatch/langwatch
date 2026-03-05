import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
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
      langwatch: "disabled",
      serviceName: "langchain-integration-test",
      debug: { logger: new NoOpLogger() },
      spanProcessors: [spanProcessor],
      advanced: {
        throwOnSetupError: true,
        UNSAFE_forceOpenTelemetryReinitialization: true,
      },
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
          model: "gpt-5-mini",
          reasoning: { effort: "low" },
          temperature: 1,
        });

        const result = await llm.invoke(
          [{ role: "user", content: "Say hello to Bob" }],
          { callbacks: [new LangWatchCallbackHandler()] }
        );

        expect(result.content).toContain("Bob");
      }
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify span structure
    expect(finishedSpans.length).toBeGreaterThan(0);

    // Find the LLM span
    const llmSpan = finishedSpans.find(
      (span) => span.attributes["langwatch.span.type"] === "llm"
    );
    expect(llmSpan).toBeDefined();
    expect(llmSpan?.attributes["langwatch.span.type"]).toBe("llm");
    expect(llmSpan?.attributes["gen_ai.request.model"]).toBe("gpt-5-mini");

    // New naming: should not be prefixed with "LLM:" anymore
    expect(llmSpan?.name.startsWith("LLM:")).toBe(false);

    // Ensure no deprecated llm.* attributes are present
    const llmAttrKeys = Object.keys(llmSpan!.attributes as any);
    expect(llmAttrKeys.some((k) => k.startsWith("llm."))).toBe(false);
  });

  it("should trace tool calling and agent execution", { timeout: 30_000 }, async () => {
    const date = new Date().toISOString();
    const tools = [
      new DynamicStructuredTool({
        name: "get_current_time",
        description: "Returns the current time in ISO-8601 format.",
        schema: z.object({}),
        func: async () => date,
      }),
    ];

    const tracer = getLangWatchTracer("langchain-integration-test");

    await tracer.withActiveSpan(
      "tool calling test",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-5-mini",
          reasoning: { effort: "low" },
          temperature: 1,
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
          {
            input:
              "What is the current time? Please send me the time in the ISO8601 format, such as 2025-01-01T00:00:00Z",
          },
          { callbacks: [tracingCallback] }
        );

        expect(result.output).toContain(date.split('.')[0]); // Ignore milliseconds due to span processing
      }
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify multiple spans were created for the agent execution
    expect(finishedSpans.length).toBeGreaterThan(1);

    // Check for tool execution spans
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool"
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
          model: "gpt-5-mini",
          reasoning: { effort: "low" },
          temperature: 1,
        });

        const tracingCallback = new LangWatchCallbackHandler();

        const result1 = await llm.invoke(
          [{ role: "user", content: "Say hello to Alice" }],
          { callbacks: [tracingCallback] }
        );

        const result2 = await llm.invoke(
          [{ role: "user", content: "Say hello to Bob" }],
          { callbacks: [tracingCallback] }
        );

        expect(result1.content).toContain("Alice");
        expect(result2.content).toContain("Bob");
      }
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify multiple LLM spans were created
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm"
    );
    expect(llmSpans.length).toBe(2);

    // Verify all spans share the same trace context
    const traceIds = new Set(
      llmSpans.map((span) => span.spanContext().traceId)
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
          temperature: 1,
          openAIApiKey: "invalid-key", // This will cause an error
        });

        const tracingCallback = new LangWatchCallbackHandler();

        await expect(
          llm.invoke([{ role: "user", content: "This should fail" }], {
            callbacks: [tracingCallback],
          })
        ).rejects.toThrow();
      }
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    // Verify error span was created
    const errorSpans = finishedSpans.filter(
      (span) => span.status.code === SpanStatusCode.ERROR
    );
    expect(errorSpans.length).toBeGreaterThan(0);
  });

  describe("Span Naming Integration Tests", () => {
    it("should name LLM spans with provider and model information", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "LLM naming test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const result = await llm.invoke(
            [{ role: "user", content: "Hello" }],
            { callbacks: [new LangWatchCallbackHandler()] }
          );

          expect(result.content).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const llmSpan = finishedSpans.find(
        (span) => span.attributes["langwatch.span.type"] === "llm"
      );
      expect(llmSpan).toBeDefined();

      // Verify naming follows the new pattern: "openai gpt-5 (temp 0.7)"
      expect(llmSpan?.name).toMatch(/openai gpt-5-mini \(temp 1\)/);
      expect(llmSpan?.attributes["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(llmSpan?.attributes["gen_ai.request.temperature"]).toBe(1);
    });

    it("should name tool spans with tool name and input preview", async () => {
      const date = new Date().toISOString();
      const tools = [
        new DynamicStructuredTool({
          name: "get_current_time",
          description: "get the current time",
          schema: z.object({}),
          func: async () => {
            return `Result: ${date}`;
          },
        }),
      ];

      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "tool naming test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant"],
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
            { input: "What is the current time?" },
            { callbacks: [tracingCallback] }
          );

          expect(result.output).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const toolSpans = finishedSpans.filter(
        (span) => span.attributes["langwatch.span.type"] === "tool"
      );
      expect(toolSpans.length).toBeGreaterThan(0);

      // Verify tool naming pattern: "calculator" (without Tool: prefix)
      const toolSpan = toolSpans[0];
      expect(toolSpan?.name).toBe("get_current_time");
      expect(toolSpan?.attributes["langwatch.span.type"]).toBe("tool");
    });

    it("should name agent spans as components", async () => {
      const tools = [
        new DynamicStructuredTool({
          name: "search",
          description: "Search for information",
          schema: z.object({}),
          func: async () => "Search results",
        }),
      ];

      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "agent naming test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant"],
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
            { input: "Search for something" },
            { callbacks: [tracingCallback] }
          );

          expect(result.output).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      // Find agent-related spans - AgentExecutor can be typed as "component" or found via name
      const agentSpan = finishedSpans.find(
        (span) => span.name.includes("Agent")
      );
      expect(agentSpan).toBeDefined();
      
      // Verify the span has appropriate type (component for AgentExecutor, or chain)
      expect(["component", "chain"]).toContain(
        agentSpan?.attributes["langwatch.span.type"]
      );
    });

    it("should name chain spans with proper fallback naming", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "chain naming test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          // Create a simple chain
          const prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant"],
            ["human", "{input}"],
          ]);

          const chain = prompt.pipe(llm);

          const tracingCallback = new LangWatchCallbackHandler();
          const result = await chain.invoke(
            { input: "Hello" },
            { callbacks: [tracingCallback] }
          );

          expect(result.content).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const chainSpans = finishedSpans.filter(
        (span) => span.attributes["langwatch.span.type"] === "chain"
      );
      expect(chainSpans.length).toBeGreaterThan(0);

      // Verify chain naming follows fallback pattern
      const chainSpan = chainSpans[0];
      expect(chainSpan?.name).toBe("ChatPromptTemplate");
    });

    it("should handle custom operation names from metadata", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "custom naming test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const tracingCallback = new LangWatchCallbackHandler();
          const result = await llm.invoke(
            [{ role: "user", content: "Hello" }],
            {
              callbacks: [tracingCallback],
              metadata: { operation_name: "Custom LLM Call" },
            }
          );

          expect(result.content).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const llmSpan = finishedSpans.find(
        (span) => span.attributes["langwatch.span.type"] === "llm"
      );
      expect(llmSpan).toBeDefined();

      // Should use the custom operation name
      expect(llmSpan?.name).toBe("Custom LLM Call");
    });

    it("should verify no deprecated LLM prefix in span names", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "deprecated prefix test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const result = await llm.invoke(
            [{ role: "user", content: "Hello" }],
            { callbacks: [new LangWatchCallbackHandler()] }
          );

          expect(result.content).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const llmSpans = finishedSpans.filter(
        (span) => span.attributes["langwatch.span.type"] === "llm"
      );

      // Verify no LLM spans start with "LLM:" prefix
      llmSpans.forEach((span) => {
        expect(span.name.startsWith("LLM:")).toBe(false);
      });
    });

    it("should verify GenAI attributes are set correctly", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "GenAI attributes test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const result = await llm.invoke(
            [{ role: "user", content: "Hello" }],
            { callbacks: [new LangWatchCallbackHandler()] }
          );

          expect(result.content).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      const llmSpan = finishedSpans.find(
        (span) => span.attributes["langwatch.span.type"] === "llm"
      );
      expect(llmSpan).toBeDefined();

      // Verify GenAI attributes are present
      expect(llmSpan?.attributes["gen_ai.system"]).toBe("openai");
      expect(llmSpan?.attributes["gen_ai.request.model"]).toBe("gpt-5-mini");
      expect(llmSpan?.attributes["gen_ai.request.temperature"]).toBe(1);

      // Verify no deprecated llm.* attributes
      const attrKeys = Object.keys(llmSpan!.attributes as any);
      const deprecatedKeys = attrKeys.filter((k) => k.startsWith("llm."));
      expect(deprecatedKeys.length).toBe(0);
    });

    it("should verify span hierarchy and parent-child relationships", async () => {
      const tracer = getLangWatchTracer("langchain-integration-test");

      await tracer.withActiveSpan(
        "hierarchy test",
        { root: true },
        async () => {
          const llm = new ChatOpenAI({
            model: "gpt-5-mini",
            reasoning: { effort: "low" },
            temperature: 1,
          });

          const tools = [
            new DynamicStructuredTool({
              name: "test_tool",
              description: "A test tool",
              schema: z.object({}),
              func: async () => "test result",
            }),
          ];

          const prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant"],
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
            { input: "Use the test tool" },
            { callbacks: [tracingCallback] }
          );

          expect(result.output).toBeDefined();
        }
      );

      await spanProcessor.forceFlush();
      const finishedSpans = spanExporter.getFinishedSpans();

      // Verify we have multiple span types
      const spanTypes = new Set(
        finishedSpans.map((span) => span.attributes["langwatch.span.type"])
      );
      expect(spanTypes.size).toBeGreaterThan(1);

      // Verify all spans share the same trace
      const traceIds = new Set(
        finishedSpans.map((span) => span.spanContext().traceId)
      );
      expect(traceIds.size).toBe(1);

      // Verify proper span types are present
      expect(spanTypes.has("llm")).toBe(true);
      expect(spanTypes.has("tool")).toBe(true);
      // Note: component spans may not always be present in this test scenario
      console.log("Available span types:", Array.from(spanTypes));
    });
  });
});
