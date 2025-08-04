import { setupLangWatch } from "langwatch/node";
import { getLangWatchTracer } from "langwatch";
import { semconv } from "langwatch/observability";
import * as readline from "readline";
import cliMarkdown from "cli-markdown";
import { mastra } from "./mastra/index.js";

await setupLangWatch();

const tracer = getLangWatchTracer("mastra-weather-agent-example");

async function main() {
  const threadId = crypto.randomUUID();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🌤️  Weather Agent Chatbot started! Type "quit" to exit.');
  console.log("Ask me about weather for any location and I'll help you plan activities!");
  console.log("---");

  const conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> = [
    {
      role: "system",
      content:
        "You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather. You may use markdown to format your responses.",
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

        // Set input string for tracing
        span.setInputString(userInput);

        // Generate AI response using Mastra agent
        console.log("🌤️  Checking weather and planning activities...");

        const agent = mastra.getAgent("weatherAgent");
        if (!agent) {
          throw new Error("Weather agent not found");
        }

        const response = await agent.generate([
          {
            role: "user",
            content: userInput,
          },
        ]);

        // Add AI response to conversation history
        conversationHistory.push({ role: "assistant", content: response.text });

        // Set output string for tracing
        span.setOutputString(response.text);

        // Display AI response with markdown formatting
        console.log("\nAI:");
        console.log(
          `${cliMarkdown(response.text, {
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
