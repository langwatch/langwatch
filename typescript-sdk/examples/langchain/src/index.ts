import { setupLangWatch } from "langwatch/node";
import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain";
import { getLangWatchTracer } from "langwatch";
import { semconv } from "langwatch/observability";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import * as readline from "readline";
import cliMarkdown from "cli-markdown";

await setupLangWatch();

const tracer = getLangWatchTracer("langchain-sdk-example");

async function main() {
  const threadId = crypto.randomUUID();
  const langWatchCallback = new LangWatchCallbackHandler();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🤖 AI Chatbot started! Type "quit" to exit.');
  console.log("---");

  // Initialize LangChain chat model
  const chatModel = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.7,
    callbacks: [langWatchCallback],
  });

  const conversationHistory: Array<HumanMessage | SystemMessage> = [
    new SystemMessage(
      "You are a helpful assistant that can answer questions and help with tasks. You may use markdown to format your responses."
    ),
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
        conversationHistory.push(new HumanMessage(userInput));

        // Generate AI response
        console.log("🤖 Thinking...");

        const result = await chatModel.invoke(conversationHistory, { callbacks: [] });
        const aiResponse = result.content as string;

        // Add AI response to conversation history
        conversationHistory.push(result);

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
