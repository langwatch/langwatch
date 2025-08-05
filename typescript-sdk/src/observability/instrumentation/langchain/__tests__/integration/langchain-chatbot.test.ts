import { describe, expect, it } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { LangWatchCallbackHandler } from "../../../langchain";
import { setupLangWatch } from "../../../../../client-node";
import { DynamicTool } from "@langchain/core/tools";
import { AgentExecutor, createToolCallingAgent, initializeAgentExecutorWithOptions } from "langchain/agents";
import { getLangWatchTracer } from "../../../../tracer";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { beforeEach } from "node:test";

beforeEach(async () => {
  await setupLangWatch();
});

describe("langchain chatbots", () => {
  it("it should be able to do a simple question/response", async () => {
    const tracer = getLangWatchTracer("langchain-chatbot.test");
    await tracer.withActiveSpan("simple question/response", { root: true }, async () => {
      const llm = new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0,
      });

      const result = await llm.invoke([
        { role: "user", content: "Hi im Bob" },
      ], { callbacks: [new LangWatchCallbackHandler()] });
      expect(result.content).toContain("Bob");
    });
  });

  it("it should be able to handle tool calls", async () => {
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

          if (a === void 0 || b === void 0) {
            throw new Error("Invalid input");
          }

          return String(a * b);
        },
      }),
    ];

    const tracer = getLangWatchTracer("langchain-chatbot.test");
    await tracer.withActiveSpan(
      "langchain tool call",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-4.1-mini",
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
        const result = await agentExecutor.invoke({ input: "What time is it and what is 12 times 8?" }, { callbacks: [tracingCallback] });
        expect(result.output).toContain("96");
      },
    );
  });

  it("should understand context grouping", async () => {
    const tracer = getLangWatchTracer("langchain-chatbot.test");
    await tracer.withActiveSpan(
      "context grouping",
      { root: true },
      async () => {
        const llm = new ChatOpenAI({
          model: "gpt-4o-mini",
          temperature: 0,
        });

        const tracingCallback = new LangWatchCallbackHandler();
        const result1 = await llm.invoke([
          { role: "user", content: "Hi im Alice" },
        ], { callbacks: [tracingCallback] });
        const result2 = await llm.invoke([
          { role: "user", content: "Hi im Bob" },
        ], { callbacks: [tracingCallback] });

        expect(result1.content).toContain("Alice");
        expect(result2.content).toContain("Bob");
      },
    );
  });
});
