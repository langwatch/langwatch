/**
 * Scenario-specific OTEL instrumentation.
 *
 * This creates an isolated TracerProvider for each scenario execution,
 * exporting traces to LangWatch with scenario metadata. This is separate
 * from the main server's OTEL setup to avoid trace mixing.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:scenarios:instrumentation");

export interface ScenarioInstrumentationConfig {
  /** LangWatch API endpoint */
  endpoint: string;
  /** LangWatch API key */
  apiKey: string;
  /** Scenario ID for trace attribution */
  scenarioId: string;
  /** Batch run ID for grouping traces */
  batchRunId: string;
  /** Project ID */
  projectId: string;
}

export interface ScenarioTracerHandle {
  /** The tracer provider - use for getting tracers */
  provider: NodeTracerProvider;
  /** Shutdown the provider and flush pending spans */
  shutdown: () => Promise<void>;
}

/**
 * Creates an isolated OTEL tracer provider for scenario execution.
 *
 * The provider exports traces to LangWatch with scenario-specific
 * resource attributes for proper trace attribution.
 */
export function createScenarioTracer(
  config: ScenarioInstrumentationConfig,
): ScenarioTracerHandle {
  const { endpoint, apiKey, scenarioId, batchRunId, projectId } = config;

  logger.debug(
    { scenarioId, batchRunId, endpoint },
    "Creating isolated tracer for scenario",
  );

  // Create exporter pointing to LangWatch
  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/api/otel/v1/traces`,
    headers: {
      "X-Auth-Token": apiKey,
    },
  });

  // Create resource with scenario metadata
  const resource = new Resource({
    "service.name": "langwatch-scenario",
    "langwatch.scenario.id": scenarioId,
    "langwatch.scenario.batch_run_id": batchRunId,
    "langwatch.project.id": projectId,
  });

  // Create provider with scenario-specific resource
  const provider = new NodeTracerProvider({ resource });

  // Use simple processor for scenarios (lower latency, immediate export)
  // Could use BatchSpanProcessor for production if needed
  const isProd = process.env.NODE_ENV === "production";
  const processor = isProd
    ? new BatchSpanProcessor(exporter)
    : new SimpleSpanProcessor(exporter);

  provider.addSpanProcessor(processor);
  provider.register();

  logger.info(
    { scenarioId, batchRunId },
    "Scenario tracer provider initialized",
  );

  return {
    provider,
    shutdown: async () => {
      logger.debug({ scenarioId, batchRunId }, "Shutting down scenario tracer");
      try {
        await provider.shutdown();
        logger.debug(
          { scenarioId, batchRunId },
          "Scenario tracer shutdown complete",
        );
      } catch (error) {
        logger.error(
          { error, scenarioId, batchRunId },
          "Error shutting down scenario tracer",
        );
        // Propagate error - caller decides how to handle
        throw error;
      }
    },
  };
}
