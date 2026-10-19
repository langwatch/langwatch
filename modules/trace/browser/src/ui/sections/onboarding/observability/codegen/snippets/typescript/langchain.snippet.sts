import { setupObservability } from "langwatch/observability/node"; // +
import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain"; // +
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

setupObservability({ serviceName: "<project_name>" }); // +

async function main(message: string): Promise<string> {
  const chatModel = new ChatOpenAI({ model: "gpt-5" }).withConfig({
    callbacks: [new LangWatchCallbackHandler()], // +
  });

  const result = await chatModel.invoke([new HumanMessage(message)]);
  return result.content as string;
}

console.log(await main("Hey, tell me a joke")); // +
