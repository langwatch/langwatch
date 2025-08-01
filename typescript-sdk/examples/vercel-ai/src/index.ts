import { setup } from "langwatch/node";
import { getLangWatchTracer } from "langwatch";
import { semconv } from "langwatch/observability";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as readline from "readline";
import cliMarkdown from "cli-markdown";

await setup();

const tracer = getLangWatchTracer("vercel-ai-sdk-example");

async function main() {
  const threadId = crypto.randomUUID();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🤖 AI Chatbot started! Type "quit" to exit.');
  console.log("---");

  const conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> = [
    {
      role: "system",
      content:
        "You are a helpful assistant that can answer questions and help with tasks. You may use markdown to format your responses.",
    },
  ];

  while (true) {
    let finish = false;

    await tracer.withActiveSpan("iteration", {
      attributes: {
        [semconv.ATTR_LANGWATCH_THREAD_ID]: threadId,
      },
    }, async (span) => {
      try {
        // Get user input
        const userInput = await new Promise<string>((resolve) => {
          rl.question("You: ", resolve);
        });

        // Check for exit command
        if (
          userInput.toLowerCase() === "quit" ||
          userInput.toLowerCase() === "exit"
        ) {
          console.log("👋 Goodbye!");
          finish = true;
          return;
        }

        // Skip empty input
        if (!userInput.trim()) {
          return;
        }

        // Add user message to conversation history
        conversationHistory.push({ role: "user", content: userInput });

        // Generate AI response
        console.log("🤖 Thinking...");

        const result = await generateText({
          model: openai("gpt-4.1-mini"),
          messages: conversationHistory,
          experimental_telemetry: { isEnabled: true },
        });

        const aiResponse = result.text;

        // Add AI response to conversation history
        conversationHistory.push({ role: "assistant", content: aiResponse });

        // Display AI response with markdown formatting
        console.log("AI:");
        console.log(
          `${cliMarkdown(aiResponse, {
            colors: true,
            maxWidth: 80,
            theme: {
              heading: "cyan",
              link: "blue",
              code: "green",
              blockquote: "yellow",
            },
          })}---`,
        );
      } catch (error) {
        console.error("❌ Error:", error);
        console.log("Please try again.");
      }
    });

    if (finish) {
      break;
    }
  }

  rl.close();
}

// Run the chatbot
main().catch(console.error);
