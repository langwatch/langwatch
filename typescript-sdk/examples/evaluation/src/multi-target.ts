/**
 * Multi-Target Comparison Example
 *
 * This example demonstrates how to compare different models/configurations
 * using the withTarget() API for automatic tracing and metrics capture.
 *
 * Features demonstrated:
 * - withTarget() for target-scoped spans
 * - Automatic latency capture per target
 * - Unique trace IDs per target (clickable in UI)
 * - Context inference for log() calls
 * - Parallel target execution with Promise.all
 *
 * Run with: npm run start:multi-target
 */

import "dotenv/config";
import { LangWatch } from "langwatch";
import { setupObservability } from "langwatch/observability/node";

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  console.error("❌ LANGWATCH_API_KEY is required. Create a .env file with your API key.");
  console.error("   Get your API key from https://app.langwatch.ai");
  process.exit(1);
}

// Initialize LangWatch observability (required for trace capture)
// This enables clicking through to trace details from evaluation results
await setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  },
});

// Initialize LangWatch client
const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT,
});

// Fetch dataset from LangWatch or use fallback
type DatasetEntry = { question: string };
let dataset: DatasetEntry[];

const DATASET_SLUG = process.env.TEST_DATASET_SLUG; // Set this to your dataset slug

if (DATASET_SLUG) {
  console.log(`📦 Fetching dataset: ${DATASET_SLUG}`);
  const remoteDataset = await langwatch.datasets.get<DatasetEntry>(DATASET_SLUG);
  dataset = remoteDataset.entries.map((e) => e.entry);
  console.log(`   Found ${dataset.length} entries`);
} else {
  console.log("📦 Using sample dataset (set TEST_DATASET_SLUG to fetch from LangWatch)");
  dataset = [
    { question: "Explain quantum computing in one sentence." },
    { question: "What are the benefits of exercise?" },
    { question: "How does photosynthesis work?" },
  ];
}

// Simulated LLM calls - replace with your actual LLM calls
const simulateGPT4 = async (question: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
  return `[GPT-4] This is a detailed, nuanced answer to: ${question}`;
};

const simulateGPT35 = async (question: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 150));
  return `[GPT-3.5] Quick answer to: ${question}`;
};

const simulateClaude = async (question: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 180 + Math.random() * 250));
  return `[Claude] Thoughtful response to: ${question}`;
};

const main = async () => {
  console.log("🚀 Starting multi-target comparison...\n");

  const evaluation = await langwatch.evaluation.init("typescript-model-comparison");

  await evaluation.run(
    dataset,
    async ({ item, index }) => {
      console.log(`\n[${index + 1}/${dataset.length}] "${item.question}"`);

      // Run all three models in parallel using withTarget()
      // Each withTarget() creates its own span with automatic latency capture
      const [gpt4Result, gpt35Result, claudeResult] = await Promise.all([
        // GPT-4 target
        evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
          const response = await simulateGPT4(item.question);

          // Log quality score - target and index are auto-inferred from context!
          evaluation.log("response_quality", { score: 0.9 });

          return response;
        }),

        // GPT-3.5 target
        evaluation.withTarget("gpt-3.5-turbo", { model: "openai/gpt-3.5-turbo" }, async () => {
          const response = await simulateGPT35(item.question);
          evaluation.log("response_quality", { score: 0.75 });
          return response;
        }),

        // Claude target
        evaluation.withTarget("claude-3", { model: "anthropic/claude-3-sonnet" }, async () => {
          const response = await simulateClaude(item.question);
          evaluation.log("response_quality", { score: 0.85 });
          return response;
        }),
      ]);

      // Log summary
      console.log(`  GPT-4: ${gpt4Result.duration}ms`);
      console.log(`  GPT-3.5: ${gpt35Result.duration}ms`);
      console.log(`  Claude: ${claudeResult.duration}ms`);
    },
    { concurrency: 2 } // Process 2 dataset items at a time
  );

  console.log("\n✅ Comparison complete! Check LangWatch to see charts comparing the models.");
  console.log("   - Each target has its own unique trace (clickable in UI)");
  console.log("   - Latency is automatically captured per target");
};

main().catch(console.error);
