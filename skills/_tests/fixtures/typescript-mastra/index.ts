import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "helper",
  instructions: "You are a helpful assistant.",
  model: openai("gpt-4o"),
});

const response = await agent.generate("What is the capital of France?");
console.log(response.text);
