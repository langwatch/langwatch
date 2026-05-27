/**
 * Example: Running LangWatch alongside another OTel-based SDK with
 * true provider isolation.
 *
 * LangWatch uses a dedicated TracerProvider — the global provider
 * (owned by the other SDK) is untouched. No cross-contamination.
 *
 * Run: pnpm start
 *
 * Expected: The LLM call appears in your LangWatch dashboard.
 * The "app-request" span only prints to console (external SDK).
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";

// ── Step 1: Simulate another OTel SDK initializing first ────────────
const externalProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
externalProvider.register();
console.log("[External SDK] Global TracerProvider registered.\n");

// ── Step 2: Create a dedicated provider for LangWatch ───────────────
import { setupObservability } from "langwatch/observability/node";

const lwProvider = new NodeTracerProvider();

const { shutdown } = setupObservability({
  tracerProvider: lwProvider,
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
  },
});

console.log("[LangWatch] Dedicated provider set up (global untouched).\n");

// ── Step 3: Make calls on each provider ─────────────────────────────
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

async function main() {
  // App span on the global provider → goes to external SDK only
  const appTracer = trace.getTracer("app");
  await appTracer.startActiveSpan("app-request", async (appSpan) => {
    console.log("[App] app-request span (global provider → external SDK only)\n");
    appSpan.end();
  });

  // LLM span on the dedicated provider → goes to LangWatch only
  const llmTracer = lwProvider.getTracer("langwatch-llm");
  await llmTracer.startActiveSpan("llm-call", async (llmSpan) => {
    const result = await generateText({
      model: openai("gpt-5-mini"),
      prompt: "What is OpenTelemetry in one sentence?",
    });
    console.log(`[LLM Response] ${result.text}\n`);
    llmSpan.end();
  });

  await shutdown();
  await externalProvider.shutdown();
  console.log("\n[Done] Check your LangWatch dashboard — only the LLM call should appear.");
  console.log("The 'app-request' span should only be in the console output above.");
}

main().catch(console.error);
