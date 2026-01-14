/**
 * Multi-Target Comparison Example
 *
 * This example demonstrates how to compare different models/configurations
 * using the target and metadata parameters.
 *
 * Run with: npm run start:multi-target
 */

import "dotenv/config";
import { LangWatch } from "langwatch";

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  console.error("❌ LANGWATCH_API_KEY is required. Create a .env file with your API key.");
  console.error("   Get your API key from https://app.langwatch.ai");
  process.exit(1);
}

// Sample dataset
const dataset = [
  { question: "Explain quantum computing in one sentence." },
  { question: "What are the benefits of exercise?" },
  { question: "How does photosynthesis work?" },
];

// Simulated responses from different "models"
const simulateGPT4 = async (question: string): Promise<{ text: string; latency: number }> => {
  const latency = 200 + Math.random() * 300;
  await new Promise((resolve) => setTimeout(resolve, latency));

  return {
    text: `[GPT-4 response to: ${question}] This is a detailed, nuanced answer...`,
    latency,
  };
};

const simulateGPT35 = async (question: string): Promise<{ text: string; latency: number }> => {
  const latency = 100 + Math.random() * 150;
  await new Promise((resolve) => setTimeout(resolve, latency));

  return {
    text: `[GPT-3.5 response to: ${question}] Quick answer here.`,
    latency,
  };
};

const simulateClaude = async (question: string): Promise<{ text: string; latency: number }> => {
  const latency = 180 + Math.random() * 250;
  await new Promise((resolve) => setTimeout(resolve, latency));

  return {
    text: `[Claude response to: ${question}] Thoughtful and careful response...`,
    latency,
  };
};

const main = async () => {
  console.log("🚀 Starting multi-target comparison...\n");

  const langwatch = new LangWatch({
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  });

  const evaluation = await langwatch.evaluation.init("typescript-model-comparison");

  await evaluation.run(
    dataset,
    async ({ item, index }) => {
      console.log(`\n[${index + 1}/${dataset.length}] "${item.question}"`);

      // Test GPT-4
      const gpt4Result = await simulateGPT4(item.question);
      console.log(`  GPT-4: ${gpt4Result.latency.toFixed(0)}ms`);
      evaluation.log("latency", {
        index,
        score: gpt4Result.latency,
        target: "gpt-4",
        metadata: { model: "openai/gpt-4", temperature: 0.7 },
      });
      evaluation.log("response_quality", {
        index,
        score: 0.9, // Simulated quality score
        target: "gpt-4",
      });

      // Test GPT-3.5
      const gpt35Result = await simulateGPT35(item.question);
      console.log(`  GPT-3.5: ${gpt35Result.latency.toFixed(0)}ms`);
      evaluation.log("latency", {
        index,
        score: gpt35Result.latency,
        target: "gpt-3.5-turbo",
        metadata: { model: "openai/gpt-3.5-turbo", temperature: 0.7 },
      });
      evaluation.log("response_quality", {
        index,
        score: 0.75,
        target: "gpt-3.5-turbo",
      });

      // Test Claude
      const claudeResult = await simulateClaude(item.question);
      console.log(`  Claude: ${claudeResult.latency.toFixed(0)}ms`);
      evaluation.log("latency", {
        index,
        score: claudeResult.latency,
        target: "claude-3",
        metadata: { model: "anthropic/claude-3-sonnet", temperature: 0.5 },
      });
      evaluation.log("response_quality", {
        index,
        score: 0.85,
        target: "claude-3",
      });
    },
    { concurrency: 1 } // Run sequentially to see clear output
  );

  console.log("\n✅ Comparison complete! Check LangWatch to see charts comparing the models.");
};

main().catch(console.error);
