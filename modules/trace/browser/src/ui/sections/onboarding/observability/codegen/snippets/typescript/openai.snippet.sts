import { setupObservability } from "langwatch/observability/node";
import { getLangWatchTracer } from "langwatch";
import { OpenAI } from "openai";

setupObservability({ serviceName: "<project_name>" }); // +

const tracer = getLangWatchTracer("<project_name>"); // +

async function main(message: string): Promise<string> {
  const openai = new OpenAI();

  return await tracer.withActiveSpan("main", async span => { // +
    span.setInput(message); // +

    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: message }],
    });

    const text = response.choices[0].message.content as string;
    span.setOutput(text); // +
    return text;
  }); // +
}

console.log(await main("Hey, tell me a joke"));
