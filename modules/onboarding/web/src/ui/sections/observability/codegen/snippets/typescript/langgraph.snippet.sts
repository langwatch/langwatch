import { setupObservability } from "langwatch/observability/node"; // +
import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain"; // +
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";

setupObservability({ serviceName: "<project_name>" }); // +

const GraphState = z.object({
  question: z.string(),
  final_answer: z.string().default(""),
});
type GraphStateType = z.infer<typeof GraphState>;

async function main(message: string): Promise<string> {
  const llm = new ChatOpenAI({ model: "gpt-5" });

  const generate = async (state: GraphStateType) => {
    const result = await llm.invoke([
      new SystemMessage("You are a helpful assistant."),
      new HumanMessage(state.question),
    ]);
    return { final_answer: result.content as string };
  };

  const app = new StateGraph(GraphState)
    .addNode("generate", generate)
    .addEdge(START, "generate")
    .addEdge("generate", END)
    .compile({ checkpointer: new MemorySaver() })
    .withConfig({ callbacks: [new LangWatchCallbackHandler()] }); // +

  const out = await app.invoke(
    { question: message },
    { configurable: { thread_id: crypto.randomUUID() } },
  );
  return out.final_answer;
}

console.log(await main("Hey, tell me a joke")); // +
