import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
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
 * Integration tests for complex multi-agent LangChain workflows.
 *
 * These tests verify:
 * - Multi-agent collaboration patterns
 * - Tool chaining and nested execution
 * - Complex conversation flows
 * - Error propagation in agent hierarchies
 * - Span correlation across agent boundaries
 */

function validateSpanDataIntegrity(spans: any[], expectedTypes: string[]) {
  const spansByType = spans.reduce(
    (acc, span) => {
      const type =
        (span.attributes["langwatch.span.type"] as string) ?? "undefined";
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  expectedTypes.forEach((type) => {
    expect(spansByType[type]).toBeGreaterThan(0);
    expect(spansByType[type]).toBeDefined();
  });

  spans.forEach((span) => {
    expect(span.name).toBeDefined();
    expect(span.status).toBeDefined();
    expect(span.spanContext().traceId).toBeDefined();
    expect(span.spanContext().spanId).toBeDefined();

    if (!span.attributes["langwatch.span.type"]) {
      return;
    }

    const spanType = span.attributes["langwatch.span.type"];
    if (spanType === "llm") {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
    }
  });
}

describe("LangChain Multi-Agent Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    observabilityHandle = setupObservability({
      langwatch: "disabled",
      serviceName: "langchain-multiagent-test",
      debug: { logger: new NoOpLogger() },
      spanProcessors: [spanProcessor],
      advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
      attributes: {
        "test.suite": "multi-agent-integration",
        "test.type": "complex-workflows",
      },
    });
  });

  afterEach(async () => {
    await observabilityHandle?.shutdown();
    trace.disable();
    spanExporter.reset();
  });

  it("should trace multi-agent collaboration workflow", async () => {
    const tracer = getLangWatchTracer("multi-agent-test");

    await tracer.withActiveSpan(
      "multi-agent-collaboration",
      { root: true },
      async () => {
        // Create simple research agent
        const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 }); // gpt-4.1 takes too long to respond
        const tools = [
          new DynamicStructuredTool({
            name: "search",
            description: "Search for information",
            schema: z.object({
              query: z.string().describe("The search query"),
            }),
            func: async ({ query }: { query: string }) => `Found results for: ${query}`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "You are a research assistant."],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({
          agent,
          tools,
        });

        const tracingCallback = new LangWatchCallbackHandler();

        const result = await executor.invoke(
          {
            input: "Hello, search for AI trends",
          },
          { callbacks: [tracingCallback] },
        );

        expect(result.output).toBeDefined();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBeGreaterThan(0);
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);
    const chainSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "chain",
    );
    expect(chainSpans.length).toBeGreaterThanOrEqual(1);

    chainSpans.forEach((span) => {
      expect(span.name).toBeDefined();
      expect(span.attributes["langwatch.span.type"]).toBe("chain");
      expect(span.status.code).toBeDefined();
    });
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    llmSpans.forEach((span) => {
      expect(span.name).toContain("openai gpt-4.1");
      expect(span.attributes["langwatch.span.type"]).toBe("llm");
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
    });
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    toolSpans.forEach((span) => {
      expect(span.name).toContain("search");
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
    });
  }, 30000);

  it("should handle nested agent execution with tool chains", async () => {
    const tracer = getLangWatchTracer("nested-agent-test");

    await tracer.withActiveSpan(
      "nested-agent-execution",
      { root: true },
      async () => {
        // Create agent with multiple tools for tool chaining
        const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 });
        const tools = [
          new DynamicStructuredTool({
            name: "data_collector",
            description: "Collect data from various sources",
            schema: z.object({
              task: z.string().describe("The task to collect data for"),
            }),
            func: async ({ task }: { task: string }) => `Data collected for: ${task}`,
          }),
          new DynamicStructuredTool({
            name: "data_processor",
            description: "Process and analyze collected data",
            schema: z.object({
              data: z.string().describe("The data to process"),
            }),
            func: async ({ data }: { data: string }) => `Processed: ${data}`,
          }),
          new DynamicStructuredTool({
            name: "report_generator",
            description: "Generate reports from processed data",
            schema: z.object({
              analysis: z.string().describe("The analysis to generate report from"),
            }),
            func: async ({ analysis }: { analysis: string }) => `Report: ${analysis}`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            "You are a data analysis supervisor. Use tools to collect, process, and report on data.",
          ],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({ agent, tools });
        const tracingCallback = new LangWatchCallbackHandler();

        const result = await executor.invoke(
          {
            input:
              "Collect data on market trends, process it, and create a summary report",
          },
          { callbacks: [tracingCallback] },
        );

        expect(result.output).toBeDefined();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBeGreaterThan(3);
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    const toolNames = toolSpans.map((span) => span.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        expect.stringContaining("data_collector"),
        expect.stringContaining("data_processor"),
        expect.stringContaining("report_generator"),
      ]),
    );
    toolSpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();
      expect(span.status.code).toBeDefined();

      const output = span.attributes["langwatch.output"] as string;
      if (span.name.includes("data_collector")) {
        expect(output).toContain("Data collected for:");
      } else if (span.name.includes("data_processor")) {
        expect(output).toContain("Processed:");
      } else if (span.name.includes("report_generator")) {
        expect(output).toContain("Report:");
      }
    });
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    llmSpans.forEach((span) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();
    });
  }, 30000);

  it("should trace conversational agent memory and context", async () => {
    const tracer = getLangWatchTracer("conversational-agent-test");

    await tracer.withActiveSpan(
      "conversational-flow",
      { root: true },
      async () => {
        // Create conversational agent with context tools
        const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 });
        const tools = [
          new DynamicStructuredTool({
            name: "memory_store",
            description: "Store information for later recall",
            schema: z.object({
              info: z.string().describe("Information to store"),
            }),
            func: async ({ info }: { info: string }) => `Stored: ${info}`,
          }),
          new DynamicStructuredTool({
            name: "memory_recall",
            description: "Recall stored information",
            schema: z.object({
              query: z.string().describe("Query to recall information"),
            }),
            func: async ({ query }: { query: string }) =>
              `Recalled about ${query}: renewable energy project discussion`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            "You are a helpful assistant with memory. Use tools to store and recall context.",
          ],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({ agent, tools });
        const tracingCallback = new LangWatchCallbackHandler();

        // Simplified 2-turn conversation
        const response1 = await executor.invoke(
          {
            input: "I'm working on renewable energy research",
          },
          { callbacks: [tracingCallback] },
        );
        expect(response1.output).toBeDefined();

        const response2 = await executor.invoke(
          {
            input: "What did I mention I was working on?",
          },
          { callbacks: [tracingCallback] },
        );
        expect(response2.output).toBeDefined();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBeGreaterThan(2);
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    llmSpans.forEach((span, index) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const input = span.attributes["langwatch.input"] as string;
      if (index === 0) {
        expect(input).toContain("renewable energy");
      }
      if (index > 0) {
        expect(input).toMatch(/working on|mentioned|recall/i);
      }
    });
    const memorySpans = finishedSpans.filter((span) =>
      span.name.includes("memory"),
    );
    expect(memorySpans.length).toBeGreaterThan(0);

    memorySpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const output = span.attributes["langwatch.output"] as string;
      if (span.name.includes("memory_store")) {
        expect(output).toContain("Stored:");
      } else if (span.name.includes("memory_recall")) {
        expect(output).toContain("Recalled");
      }
    });
  }, 30000);

  it("should handle agent error recovery and fallback chains", async () => {
    const tracer = getLangWatchTracer("error-recovery-test");

    await tracer.withActiveSpan(
      "error-recovery-flow",
      { root: true },
      async () => {
        // Create agent with failing and fallback tools
        const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 });
        const tools = [
          new DynamicStructuredTool({
            name: "primary_tool",
            description: "Primary data source (may fail)",
            schema: z.object({
              input: z.string().describe("Input for primary tool"),
            }),
            func: async ({ input }: { input: string }) => {
              if (input.includes("fail")) {
                throw new Error("Primary tool failed");
              }
              return `Primary result for: ${input}`;
            },
          }),
          new DynamicStructuredTool({
            name: "fallback_tool",
            description: "Backup data source",
            schema: z.object({
              input: z.string().describe("Input for fallback tool"),
            }),
            func: async ({ input }: { input: string }) => `Fallback result for: ${input}`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            "You are a resilient agent. Try primary_tool first, if it fails use fallback_tool.",
          ],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({ agent, tools });
        const tracingCallback = new LangWatchCallbackHandler();

        // This should trigger fallback behavior
        const result = await executor.invoke(
          {
            input: "Get data that will fail from primary source",
          },
          { callbacks: [tracingCallback] },
        );

        expect(result.output).toBeDefined();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBeGreaterThan(0);
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    const primaryToolSpans = toolSpans.filter((span) =>
      span.name.includes("primary_tool"),
    );
    const fallbackToolSpans = toolSpans.filter((span) =>
      span.name.includes("fallback_tool"),
    );

    expect(primaryToolSpans.length).toBeGreaterThanOrEqual(0);
    expect(fallbackToolSpans.length).toBeGreaterThan(0);
    fallbackToolSpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const output = span.attributes["langwatch.output"] as string;
      expect(output).toContain("Fallback result for:");
    });
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    llmSpans.forEach((span) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();
    });
  }, 30000);

  it("should trace parallel agent execution", async () => {
    const tracer = getLangWatchTracer("parallel-agent-test");

    await tracer.withActiveSpan(
      "parallel-execution",
      { root: true },
      async () => {
        // Create two simple agents to run in parallel
        const createAgent = (name: string) => {
          const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 });
          const tools = [
            new DynamicStructuredTool({
              name: `${name}_analysis`,
              description: `Perform ${name} analysis`,
              schema: z.object({
                task: z.string().describe("Task to analyze"),
              }),
              func: async ({ task }: { task: string }) => `${name} analysis result: ${task}`,
            }),
          ];

          const prompt = ChatPromptTemplate.fromMessages([
            ["system", `You are a ${name} specialist.`],
            ["human", "{input}"],
            ["placeholder", "{agent_scratchpad}"],
          ]);

          const agent = createToolCallingAgent({ llm, tools, prompt });
          return new AgentExecutor({ agent, tools });
        };

        const agents = [createAgent("data"), createAgent("market")];

        const tracingCallback = new LangWatchCallbackHandler();

        // Execute agents in parallel
        const results = await Promise.all(
          agents.map((agent, index) =>
            agent.invoke(
              {
                input: `Analyze trends for area ${index + 1}`,
              },
              { callbacks: [tracingCallback] },
            ),
          ),
        );

        results.forEach((result) => {
          expect(result.output).toBeDefined();
        });
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    expect(finishedSpans.length).toBeGreaterThan(2);
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(1);

    llmSpans.forEach((span) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const input = span.attributes["langwatch.input"] as string;
      expect(input).toMatch(/area \d+/);
    });
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(1);

    const toolTypes = new Set(
      toolSpans.map((span) => {
        if (span.name.includes("data_analysis")) return "data";
        if (span.name.includes("market_analysis")) return "market";
        return "unknown";
      }),
    );
    expect(toolTypes.size).toBeGreaterThan(1);
    toolSpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const output = span.attributes["langwatch.output"] as string;
      expect(output).toMatch(/(data|market) analysis result:/);
    });
  }, 30000);

  it("should verify comprehensive span data capture integrity", async () => {
    const tracer = getLangWatchTracer("data-integrity-test");

    await tracer.withActiveSpan(
      "data-integrity-validation",
      { root: true },
      async () => {
        // Create a simple agent to test data capture
        const llm = new ChatOpenAI({ model: "gpt-4.1", temperature: 1 });
        const tools = [
          new DynamicStructuredTool({
            name: "test_tool",
            description: "Test tool for data validation",
            schema: z.object({
              input: z.string().describe("Input to process"),
            }),
            func: async ({ input }: { input: string }) => `Processed: ${input}`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "You are a test agent for data validation."],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({ agent, tools });
        const tracingCallback = new LangWatchCallbackHandler();

        const result = await executor.invoke(
          {
            input: "Test input for data validation",
          },
          { callbacks: [tracingCallback] },
        );

        expect(result.output).toBeDefined();
      },
    );

    await spanProcessor.forceFlush();
    const finishedSpans = spanExporter.getFinishedSpans();

    const spanAnalysis = finishedSpans.map((span, index) => {
      const attributes = span.attributes;
      const spanType =
        (attributes["langwatch.span.type"] as string) ?? "undefined";
      return {
        index,
        name: span.name,
        type: spanType,
        status: span.status.code,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        attributeCount: Object.keys(attributes).length,
        hasInput: !!attributes["langwatch.input"],
        hasOutput: !!attributes["langwatch.output"],
        hasModel: !!attributes["gen_ai.request.model"],
        allAttributes: Object.keys(attributes),
      };
    });

    expect(finishedSpans.length).toBeGreaterThan(0);

    const spansByType: Record<string, number> = {};
    spanAnalysis.forEach((span) => {
      spansByType[span.type] = (spansByType[span.type] ?? 0) + 1;
    });

    expect(spansByType.chain).toBeGreaterThan(0);
    expect(spansByType.llm).toBeGreaterThan(0);
    expect(spansByType.tool).toBeGreaterThan(0);

    const uniqueTraceIds = new Set(spanAnalysis.map((s) => s.traceId));
    expect(uniqueTraceIds.size).toBe(1);

    const llmSpans = spanAnalysis.filter((s) => s.type === "llm");
    llmSpans.forEach((span) => {
      expect(span.hasModel).toBe(true);
    });
  }, 30000);
});
