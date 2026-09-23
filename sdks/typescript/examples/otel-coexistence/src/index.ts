/**
 * Runs LangWatch alongside another OTel SDK via its own dedicated
 * TracerProvider (the global one, owned by the other SDK, stays untouched).
 * Auto-instrumentation via the global API is NOT isolated by this.
 */

import { trace } from "@opentelemetry/api";
import { SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

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

// ── Step 3: Create spans on each provider ───────────────────────────
async function main() {
  // App span on the global provider → external SDK only, NOT LangWatch
  const appTracer = trace.getTracer("app");
  appTracer.startActiveSpan("app-request", (span) => {
    console.log("[App] 'app-request' span → global provider (external SDK only)");
    span.end();
  });

  // LLM span on the dedicated provider → LangWatch only, NOT external SDK
  const llmTracer = lwProvider.getTracer("langwatch-llm");
  llmTracer.startActiveSpan("llm-call", (span) => {
    span.setAttribute("gen_ai.system", "openai");
    span.setAttribute("gen_ai.request.model", "gpt-5-mini");
    console.log("[LLM] 'llm-call' span → dedicated provider (LangWatch only)");
    span.end();
  });

  console.log();
  await shutdown();
  await externalProvider.shutdown();
  console.log("[Done] Check your LangWatch dashboard — only 'llm-call' should appear.");
  console.log("The 'app-request' span should only be in the console output above.");
}

main().catch(console.error);
