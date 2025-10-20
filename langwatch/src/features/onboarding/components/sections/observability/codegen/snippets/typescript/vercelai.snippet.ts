import { setupObservability } from "@langwatch/observability/node"; // +
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

setupObservability({ // +
  serviceName: "<project_name>", // +
}); // +

async function main(message: string): Promise<string> {
  const response = await generateText({
    model: openai("gpt-5-mini"),
    prompt: message,
    experimental_telemetry: { isEnabled: true }, // +
  });
  return response.text;
}

console.log(await main("Hello, world!")); // +
