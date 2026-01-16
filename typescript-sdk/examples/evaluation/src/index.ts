/**
 * Basic Evaluation Example
 *
 * This example demonstrates how to run a simple batch evaluation
 * with custom metrics using the LangWatch TypeScript SDK.
 *
 * Run with: npm start
 */

import "dotenv/config";
import { LangWatch } from "langwatch";

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  console.error("❌ LANGWATCH_API_KEY is required. Create a .env file with your API key.");
  console.error("   Get your API key from https://app.langwatch.ai");
  process.exit(1);
}

// Sample dataset - in practice, you'd load this from a file or API
const dataset = [
  { question: "What is 2+2?", expected: "4" },
  { question: "What is the capital of France?", expected: "Paris" },
  { question: "What color is the sky?", expected: "blue" },
  { question: "How many days in a week?", expected: "7" },
  { question: "What is H2O?", expected: "water" },
];

// Simulated LLM response function
const simulateLLM = async (question: string): Promise<string> => {
  // Simulate some latency
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

  // Simple mock responses
  const responses: Record<string, string> = {
    "What is 2+2?": "4",
    "What is the capital of France?": "Paris",
    "What color is the sky?": "blue",
    "How many days in a week?": "7",
    "What is H2O?": "water",
  };

  return responses[question] ?? "I don't know";
};

const main = async () => {
  console.log("🚀 Starting evaluation...\n");

  // Initialize LangWatch client
  const langwatch = new LangWatch({
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  });

  // Initialize evaluation with experiment name
  const evaluation = await langwatch.evaluation.init("basic-typescript-eval");

  // Run evaluation over dataset
  await evaluation.run(
    dataset,
    async ({ item, index }) => {
      console.log(`Processing item ${index + 1}/${dataset.length}: "${item.question}"`);

      // Call your LLM/agent
      const response = await simulateLLM(item.question);

      // Calculate accuracy (exact match)
      const isCorrect = response.toLowerCase() === item.expected.toLowerCase();

      // Log custom metrics
      evaluation.log("accuracy", {
        index,
        passed: isCorrect,
        data: {
          question: item.question,
          expected: item.expected,
          actual: response,
        },
      });

      // Log a score metric
      evaluation.log("confidence", {
        index,
        score: isCorrect ? 1.0 : 0.0,
      });
    },
    { concurrency: 2 }
  );

  console.log("\n✅ Evaluation complete! Check the LangWatch UI for results.");
};

main().catch(console.error);
