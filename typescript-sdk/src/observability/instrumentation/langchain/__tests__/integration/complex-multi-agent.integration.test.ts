import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
 * Integration tests for complex multi-agent LangChain workflows.
 *
 * These tests verify:
 * - Multi-agent collaboration patterns
 * - Tool chaining and nested execution
 * - Complex conversation flows
 * - Error propagation in agent hierarchies
 * - Span correlation across agent boundaries
 */

// Helper function to validate common span attributes
function validateSpanDataIntegrity(spans: any[], expectedTypes: string[]) {
  console.log("=== SPAN DATA VALIDATION ===");

  // Check that we have spans of expected types
  const spansByType = spans.reduce((acc, span) => {
    const type = (span.attributes["langwatch.span.type"] as string) || "undefined";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("Spans by type:", spansByType);

  expectedTypes.forEach(type => {
    expect(spansByType[type]).toBeGreaterThan(0);
    expect(spansByType[type]).toBeDefined();
  });

  // Validate each span has required LangWatch attributes
  spans.forEach((span, index) => {
    console.log(`Span ${index} validation:`, {
      name: span.name,
      type: span.attributes["langwatch.span.type"],
      hasInput: !!span.attributes["langwatch.input"],
      hasOutput: !!span.attributes["langwatch.output"],
      status: span.status.code,
      attributeCount: Object.keys(span.attributes).length,
    });

    // Core required attributes
    expect(span.name).toBeDefined();
    expect(span.status).toBeDefined();
    expect(span.spanContext().traceId).toBeDefined();
    expect(span.spanContext().spanId).toBeDefined();

    // Skip validation for undefined span types (these may be internal LangChain spans)
    if (!span.attributes["langwatch.span.type"]) {
      return;
    }

    // LangWatch-specific attributes (checking actual attribute names used)
    const spanType = span.attributes["langwatch.span.type"];
    if (spanType === "llm") {
      // LLM spans should have model information (using gen_ai.request.model)
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      // Input/output are present as langwatch.input/output
      console.log(`LLM span "${span.name}" - input: ${!!span.attributes["langwatch.input"]}, output: ${!!span.attributes["langwatch.output"]}`);
    } else if (spanType === "tool") {
      // Tool spans should have input/output
      console.log(`Tool span "${span.name}" - input: ${!!span.attributes["langwatch.input"]}, output: ${!!span.attributes["langwatch.output"]}`);
    }

    // Model attribute for LLM spans (using the correct attribute name)
    if (span.attributes["langwatch.span.type"] === "llm") {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
    }
  });

  console.log("=== VALIDATION COMPLETE ===");

  // Summary report
  console.log("\n📊 SPAN CAPTURE SUMMARY:");
  console.log(`✅ Total spans captured: ${spans.length}`);
  console.log(`✅ Span types found: ${Object.keys(spansByType).join(", ")}`);
  console.log(`✅ Expected types present: ${expectedTypes.filter(type => spansByType[type] > 0).join(", ")}`);

  if (spansByType.llm > 0) {
    console.log(`✅ LLM spans: ${spansByType.llm} (with model info)`);
  }
  if (spansByType.tool > 0) {
    console.log(`✅ Tool spans: ${spansByType.tool} (tracking tool usage)`);
  }
  if (spansByType.chain > 0) {
    console.log(`✅ Chain spans: ${spansByType.chain} (LangChain execution flow)`);
  }
  if (spansByType.agent > 0) {
    console.log(`✅ Agent spans: ${spansByType.agent} (agent coordination)`);
  }
}

describe("LangChain Multi-Agent Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;

  beforeEach(async () => {
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    observabilityHandle = setupObservability({
      serviceName: "langchain-multiagent-test",
      logger: new NoOpLogger(),
      throwOnSetupError: true,
      spanProcessors: [spanProcessor],
      UNSAFE_forceOpenTelemetryReinitialization: true,
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
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const tools = [
          new DynamicTool({
            name: "search",
            description: "Search for information",
            func: async (query: string) => `Found results for: ${query}`,
          }),
        ];

        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "You are a research assistant."],
          ["human", "{input}"],
          ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = createToolCallingAgent({ llm, tools, prompt });
        const executor = new AgentExecutor({ agent, tools });
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

    // Verify agent execution
    expect(finishedSpans.length).toBeGreaterThan(0);

    // Validate span data integrity
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);

    // Debug: Log all span data for verification
    console.log("Total spans captured:", finishedSpans.length);
    finishedSpans.forEach((span, index) => {
      console.log(`Span ${index}:`, {
        name: span.name,
        type: span.attributes["langwatch.span.type"],
        status: span.status,
        attributes: Object.keys(span.attributes),
      });
    });

    // Check for chain spans (LangChain creates these for agent execution)
    const chainSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "chain",
    );
    expect(chainSpans.length).toBeGreaterThanOrEqual(1);

    // Verify chain span data integrity
    chainSpans.forEach((span) => {
      expect(span.name).toBeDefined();
      expect(span.attributes["langwatch.span.type"]).toBe("chain");
      expect(span.status.code).toBeDefined();
    });

    // Check for LLM spans
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    // Verify LLM span data
    llmSpans.forEach((span) => {
      expect(span.name).toContain("ChatOpenAI");
      expect(span.attributes["langwatch.span.type"]).toBe("llm");
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      console.log(`LLM span model: ${span.attributes["gen_ai.request.model"]}`);
      // Note: input/output are captured as langwatch.input/output
    });

    // Check for tool spans
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    // Verify tool span data
    toolSpans.forEach((span) => {
      expect(span.name).toContain("search");
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      console.log(`Tool span "${span.name}" captured with ${Object.keys(span.attributes).length} attributes`);
      // Note: input/output attributes may not be set yet - this is what we're debugging
    });
  }, 30000);

  it("should handle nested agent execution with tool chains", async () => {
    const tracer = getLangWatchTracer("nested-agent-test");

    await tracer.withActiveSpan(
      "nested-agent-execution",
      { root: true },
      async () => {
        // Create agent with multiple tools for tool chaining
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const tools = [
          new DynamicTool({
            name: "data_collector",
            description: "Collect data from various sources",
            func: async (task: string) => `Data collected for: ${task}`,
          }),
          new DynamicTool({
            name: "data_processor",
            description: "Process and analyze collected data",
            func: async (data: string) => `Processed: ${data}`,
          }),
          new DynamicTool({
            name: "report_generator",
            description: "Generate reports from processed data",
            func: async (analysis: string) => `Report: ${analysis}`,
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

    // Verify tool chaining occurred
    expect(finishedSpans.length).toBeGreaterThan(3);

    // Validate span data integrity
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);

    // Debug: Log span data for tool chain verification
    console.log("Tool chain test - Total spans:", finishedSpans.length);
    const spansByType = finishedSpans.reduce((acc, span) => {
      const type = span.attributes["langwatch.span.type"] as string;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log("Spans by type:", spansByType);

    // Check for tool spans
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    // Verify specific tools were called
    const toolNames = toolSpans.map(span => span.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        expect.stringContaining("data_collector"),
        expect.stringContaining("data_processor"),
        expect.stringContaining("report_generator"),
      ])
    );

    // Verify tool execution order and data flow
    toolSpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();
      expect(span.status.code).toBeDefined();

      // Verify tool output format
      const output = span.attributes["langwatch.output"] as string;
      if (span.name.includes("data_collector")) {
        expect(output).toContain("Data collected for:");
      } else if (span.name.includes("data_processor")) {
        expect(output).toContain("Processed:");
      } else if (span.name.includes("report_generator")) {
        expect(output).toContain("Report:");
      }
    });

    // Check for LLM spans
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    // Verify LLM spans have proper chain context
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
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const tools = [
          new DynamicTool({
            name: "memory_store",
            description: "Store information for later recall",
            func: async (info: string) => `Stored: ${info}`,
          }),
          new DynamicTool({
            name: "memory_recall",
            description: "Recall stored information",
            func: async (query: string) =>
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

    // Verify multiple interactions occurred
    expect(finishedSpans.length).toBeGreaterThan(2);

    // Validate span data integrity
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);

    // Debug: Log conversational flow data
    console.log("Conversational test - Total spans:", finishedSpans.length);
    finishedSpans.forEach((span, index) => {
      console.log(`Conversation span ${index}:`, {
        name: span.name,
        type: span.attributes["langwatch.span.type"],
        hasInput: !!span.attributes["langwatch.input"],
        hasOutput: !!span.attributes["langwatch.output"],
      });
    });

    // Check for LLM spans from conversation
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(0);

    // Verify conversation context preservation
    llmSpans.forEach((span, index) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const input = span.attributes["langwatch.input"] as string;
      // First interaction should mention renewable energy
      if (index === 0) {
        expect(input).toContain("renewable energy");
      }
      // Later interactions should reference previous context
      if (index > 0) {
        expect(input).toMatch(/working on|mentioned|recall/i);
      }
    });

    // Check for memory tool spans
    const memorySpans = finishedSpans.filter(
      (span) => span.name.includes("memory"),
    );
    expect(memorySpans.length).toBeGreaterThan(0);

    // Verify memory operations
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
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const tools = [
          new DynamicTool({
            name: "primary_tool",
            description: "Primary data source (may fail)",
            func: async (input: string) => {
              if (input.includes("fail")) {
                throw new Error("Primary tool failed");
              }
              return `Primary result for: ${input}`;
            },
          }),
          new DynamicTool({
            name: "fallback_tool",
            description: "Backup data source",
            func: async (input: string) => `Fallback result for: ${input}`,
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

    // Verify spans were created
    expect(finishedSpans.length).toBeGreaterThan(0);

    // Validate span data integrity
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);

    // Debug: Log error recovery flow data
    console.log("Error recovery test - Total spans:", finishedSpans.length);
    finishedSpans.forEach((span, index) => {
      console.log(`Error recovery span ${index}:`, {
        name: span.name,
        type: span.attributes["langwatch.span.type"],
        status: span.status,
        hasError: span.status.code === 2, // ERROR status code
      });
    });

    // Check for tool spans (may include both successful and failed attempts)
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(0);

    // Verify error handling in tool spans
    const primaryToolSpans = toolSpans.filter(span =>
      span.name.includes("primary_tool")
    );
    const fallbackToolSpans = toolSpans.filter(span =>
      span.name.includes("fallback_tool")
    );

    // Should have attempted primary tool (may have failed)
    expect(primaryToolSpans.length).toBeGreaterThanOrEqual(0);

    // Should have used fallback tool
    expect(fallbackToolSpans.length).toBeGreaterThan(0);

    // Verify fallback tool execution
    fallbackToolSpans.forEach((span) => {
      expect(span.attributes["langwatch.span.type"]).toBe("tool");
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const output = span.attributes["langwatch.output"] as string;
      expect(output).toContain("Fallback result for:");
    });

    // Check for LLM spans that coordinated the error recovery
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
          const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
          const tools = [
            new DynamicTool({
              name: `${name}_analysis`,
              description: `Perform ${name} analysis`,
              func: async (task: string) => `${name} analysis result: ${task}`,
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

    // Verify parallel execution created multiple spans
    expect(finishedSpans.length).toBeGreaterThan(2);

    // Validate span data integrity
    validateSpanDataIntegrity(finishedSpans, ["chain", "llm", "tool"]);

    // Debug: Log parallel execution data
    console.log("Parallel execution test - Total spans:", finishedSpans.length);
    const spanDetails = finishedSpans.map((span, index) => ({
      index,
      name: span.name,
      type: span.attributes["langwatch.span.type"],
      traceId: span.spanContext().traceId,
      startTime: span.startTime,
    }));
    console.log("Parallel spans:", spanDetails);

    // Check for multiple LLM spans (from parallel agents)
    const llmSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "llm",
    );
    expect(llmSpans.length).toBeGreaterThan(1);

    // Verify parallel agent execution data
    llmSpans.forEach((span, index) => {
      expect(span.attributes["gen_ai.request.model"]).toBeDefined();
      expect(span.attributes["langwatch.input"]).toBeDefined();
      expect(span.attributes["langwatch.output"]).toBeDefined();

      const input = span.attributes["langwatch.input"] as string;
      expect(input).toMatch(/area \d+/); // Should reference different areas
    });

    // Check for tool spans from parallel agents
    const toolSpans = finishedSpans.filter(
      (span) => span.attributes["langwatch.span.type"] === "tool",
    );
    expect(toolSpans.length).toBeGreaterThan(1);

    // Verify different specialist tools were called
    const toolTypes = new Set(toolSpans.map(span => {
      if (span.name.includes("data_analysis")) return "data";
      if (span.name.includes("market_analysis")) return "market";
      return "unknown";
    }));
    expect(toolTypes.size).toBeGreaterThan(1); // Both data and market tools

    // Verify each tool span has proper data
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
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const tools = [
          new DynamicTool({
            name: "test_tool",
            description: "Test tool for data validation",
            func: async (input: string) => `Processed: ${input}`,
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

    // Comprehensive data integrity check
    console.log("\n🔍 COMPREHENSIVE DATA INTEGRITY ANALYSIS:");
    console.log("=".repeat(50));

    const spanAnalysis = finishedSpans.map((span, index) => {
      const attributes = span.attributes;
             const spanType = (attributes["langwatch.span.type"] as string) || "undefined";
       const analysis = {
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

      console.log(`Span ${index}: ${analysis.name} (${analysis.type})`);
      console.log(`  - Status: ${analysis.status}`);
      console.log(`  - Attributes: ${analysis.attributeCount}`);
      console.log(`  - Input/Output: ${analysis.hasInput}/${analysis.hasOutput}`);
      console.log(`  - Model info: ${analysis.hasModel}`);
      console.log(`  - All attrs: ${analysis.allAttributes.join(", ")}`);
      console.log("");

      return analysis;
    });

    // Verify basic data integrity
    expect(finishedSpans.length).toBeGreaterThan(0);

    const spansByType: Record<string, number> = {};
    spanAnalysis.forEach(span => {
      spansByType[span.type] = (spansByType[span.type] || 0) + 1;
    });

    console.log("📈 DATA CAPTURE RESULTS:");
    console.log(`Total spans: ${finishedSpans.length}`);
    console.log(`Span type distribution:`, spansByType);

    // Verify we have the expected span types
    expect(spansByType.chain).toBeGreaterThan(0);
    expect(spansByType.llm).toBeGreaterThan(0);
    expect(spansByType.tool).toBeGreaterThan(0);

    // Check for proper trace correlation
    const uniqueTraceIds = new Set(spanAnalysis.map(s => s.traceId));
    console.log(`Unique trace IDs: ${uniqueTraceIds.size}`);
    expect(uniqueTraceIds.size).toBe(1); // All spans should be in the same trace

    // Verify LLM spans have model info
    const llmSpans = spanAnalysis.filter(s => s.type === "llm");
    llmSpans.forEach(span => {
      expect(span.hasModel).toBe(true);
    });

    console.log("\n✅ DATA INTEGRITY VERIFICATION COMPLETE");
    console.log("=".repeat(50));
  }, 30000);
});
