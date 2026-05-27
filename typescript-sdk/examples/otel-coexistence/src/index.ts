/**
 * Example: Running LangWatch alongside another OTel-based SDK.
 *
 * This simulates a real-world scenario where another SDK (e.g. an APM)
 * has already initialized a global TracerProvider. LangWatch attaches
 * its processors to the existing provider using attachToExistingProvider.
 *
 * Run: pnpm start
 *
 * Expected: You should see the LLM call appear in your LangWatch
 * dashboard, and the "external" SDK's spans printed to the console.
 */

import { NodeTracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";

// ── Step 1: Simulate another OTel SDK initializing first ────────────
// In production this would be Sentry, Datadog, New Relic, etc.
const externalProvider = new NodeTracerProvider();
externalProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
externalProvider.register();
console.log("[External SDK] Global TracerProvider registered.\n");

// ── Step 2: Initialize LangWatch with attachToExistingProvider ──────
import { setupObservability } from "langwatch/observability/node";

const { shutdown } = setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
  },
  advanced: {
    attachToExistingProvider: true,
  },
});

console.log("[LangWatch] Attached to existing provider.\n");

// ── Step 3: Make an LLM call — should appear in LangWatch ──────────
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

async function main() {
  const tracer = trace.getTracer("otel-coexistence-example");

  // This span simulates app-level work (the kind the other SDK cares about).
  // It will appear in the console (external SDK) AND in LangWatch.
  await tracer.startActiveSpan("app-request", async (appSpan) => {
    console.log("[App] Starting request...\n");

    // This LLM call will be auto-instrumented and sent to LangWatch.
    const result = await generateText({
      model: openai("gpt-5-mini"),
      prompt: "What is OpenTelemetry in one sentence?",
      experimental_telemetry: { isEnabled: true },
    });

    console.log(`[LLM Response] ${result.text}\n`);

    appSpan.end();
  });

  // Flush everything before exiting
  await shutdown();
  await externalProvider.shutdown();
  console.log("\n[Done] Check your LangWatch dashboard for the LLM trace.");
}

main().catch(console.error);
