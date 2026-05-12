import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

async function chat(message: string) {
  const result = await generateText({
    model: openai("gpt-4o"),
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: message },
    ],
  });
  return result.text;
}

const response = await chat("Hello!");
console.log(response);
