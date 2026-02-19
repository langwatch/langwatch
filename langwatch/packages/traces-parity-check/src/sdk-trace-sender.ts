/**
 * SDK Setup for dual-exporter OTEL traces
 *
 * Sets up the LangWatch SDK with dual exporters to send traces
 * to both ES and CH projects simultaneously.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getLangWatchTracer } from "langwatch/observability";
import { sleep } from "./utils.js";

type Tracer = ReturnType<typeof getLangWatchTracer>;

export interface DualExporterSDK {
  tracer: Tracer;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Setup the SDK with dual exporters for ES and CH projects
 *
 * This creates a single OpenTelemetry SDK instance with two span processors,
 * each sending to a different project. This avoids the global state issues
 * that occur when trying to reinitialize OpenTelemetry multiple times.
 */
export async function setupDualExporterSDK(
  endpoint: string,
  esApiKey: string,
  chApiKey: string,
  prodApiKey: string | null = null,
  runPrefix?: string,
): Promise<DualExporterSDK> {
  // Set run prefix as OTEL resource attribute so it appears in trace metadata
  if (runPrefix) {
    const existing = process.env["OTEL_RESOURCE_ATTRIBUTES"] ?? "";
    const prefix = existing ? `${existing},` : "";
    process.env["OTEL_RESOURCE_ATTRIBUTES"] = `${prefix}parity.run=${runPrefix}`;
  }

  const otelEndpoint = `${endpoint}/api/otel/v1/traces`;

  // Create exporters for both projects
  const esExporter = new OTLPTraceExporter({
    url: otelEndpoint,
    headers: { authorization: `Bearer ${esApiKey}` },
    timeoutMillis: 120000,
  });

  const chExporter = new OTLPTraceExporter({
    url: otelEndpoint,
    headers: { authorization: `Bearer ${chApiKey}` },
    timeoutMillis: 120000,
  });

  // Batch processor config for efficient export
  const batchConfig = {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 60000,
  };

  const esProcessor = new BatchSpanProcessor(esExporter, batchConfig);
  const chProcessor = new BatchSpanProcessor(chExporter, batchConfig);
  const processors = [esProcessor, chProcessor];

  // Optional production exporter
  let prodProcessor: BatchSpanProcessor | null = null;
  if (prodApiKey) {
    const prodExporter = new OTLPTraceExporter({
      url: "https://app.langwatch.ai/api/otel/v1/traces",
      headers: { authorization: `Bearer ${prodApiKey}` },
      timeoutMillis: 120000,
    });
    prodProcessor = new BatchSpanProcessor(prodExporter, batchConfig);
    processors.push(prodProcessor);
  }

  console.log(`  Setting up dual-exporter SDK...`);
  console.log(`  ES endpoint: ${otelEndpoint}`);
  console.log(`  CH endpoint: ${otelEndpoint}`);
  if (prodApiKey) {
    console.log(`  Prod endpoint: https://app.langwatch.ai/api/otel/v1/traces`);
  }

  // Setup single SDK with all processors
  const handle = setupObservability({
    langwatch: "disabled", // We provide our own processors
    serviceName: "parity-check",
    debug: { logLevel: "warn" },
    spanProcessors: processors,
    advanced: {
      UNSAFE_forceOpenTelemetryReinitialization: true,
      disableAutoShutdown: true,
    },
  });

  const tracer = getLangWatchTracer("parity-check");

  return {
    tracer,
    flush: async () => {
      console.log("  Flushing batch exporters...");
      await esProcessor.forceFlush();
      await chProcessor.forceFlush();
      if (prodProcessor) {
        await prodProcessor.forceFlush();
      }
      // Give extra time for network requests
      console.log("  Waiting for exports to complete...");
      await sleep(5000);
    },
    shutdown: async () => {
      console.log("  Shutting down SDK...");
      await handle.shutdown();
    },
  };
}

