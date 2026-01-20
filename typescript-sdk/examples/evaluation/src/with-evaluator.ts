/**
 * Evaluation with Built-in Evaluators Example
 *
 * This example shows how to use LangWatch's built-in evaluators
 * (like exact_match) alongside custom metrics.
 *
 * Run with: npm run start:with-evaluator
 */

import "dotenv/config";
import { LangWatch } from "langwatch";

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  console.error("❌ LANGWATCH_API_KEY is required. Create a .env file with your API key.");
  console.error("   Get your API key from https://app.langwatch.ai");
  process.exit(1);
}

// Sample Q&A dataset
const dataset = [
  {
    question: "What is the largest planet in our solar system?",
    expected: "Jupiter",
  },
  {
    question: "Who wrote Romeo and Juliet?",
    expected: "William Shakespeare",
  },
  {
    question: "What is the chemical symbol for gold?",
    expected: "Au",
  },
  {
    question: "In what year did World War II end?",
    expected: "1945",
  },
];

// Simulated LLM with varying quality
const simulateLLM = async (question: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 150));

  const responses: Record<string, string> = {
    "What is the largest planet in our solar system?": "Jupiter",
    "Who wrote Romeo and Juliet?": "Shakespeare", // Partial match
    "What is the chemical symbol for gold?": "Au",
    "In what year did World War II end?": "1945",
  };

  return responses[question] ?? "Unknown";
};

const main = async () => {
  console.log("🚀 Starting evaluation with built-in evaluators...\n");

  const langwatch = new LangWatch({
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  });

  const evaluation = await langwatch.evaluation.init("typescript-with-evaluators");

  await evaluation.run(
    dataset,
    async ({ item, index }) => {
      console.log(`[${index + 1}/${dataset.length}] ${item.question}`);

      const response = await simulateLLM(item.question);
      console.log(`  → Response: "${response}" (expected: "${item.expected}")`);

      // Use built-in exact_match evaluator
      try {
        await evaluation.evaluate("langevals/exact_match", {
          index,
          name: "exact_match",
          data: {
            output: response,
            expected_output: item.expected,
          },
        });
      } catch (error) {
        console.log(`  ⚠️ Evaluator error: ${error}`);
      }

      // Also log response length as a custom metric
      evaluation.log("response_length", {
        index,
        score: response.length,
        data: { response },
      });
    },
    { concurrency: 2 }
  );

  console.log("\n✅ Evaluation complete!");
};

main().catch(console.error);
