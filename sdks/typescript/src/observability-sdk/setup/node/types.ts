import { type Logger } from "../../../logger";
import { type Instrumentation } from "@opentelemetry/instrumentation";
import { type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  type ContextManager,
  type TextMapPropagator,
  type TracerProvider,
} from "@opentelemetry/api";
import { type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { type IMetricReader } from "@opentelemetry/sdk-metrics";
import { type ViewOptions } from "@opentelemetry/sdk-metrics";
import { type Resource, type ResourceDetector } from "@opentelemetry/resources";
import { type Sampler, type SpanLimits } from "@opentelemetry/sdk-trace-base";
import { type IdGenerator } from "@opentelemetry/sdk-trace-base";
import { type SemConvAttributes } from "../../semconv";
import { type DataCaptureOptions } from "../../features/data-capture/types";

/**
 * Configuration options for setting up LangWatch observability.
 * See the docs for example configuration and field-by-field details.
 */
export interface SetupObservabilityOptions {
  /**
   * LangWatch configuration for sending observability data to LangWatch.
   *
   * Set to 'disabled' to completely disable LangWatch integration.
   * API key and endpoint can also be set via LANGWATCH_API_KEY and
   * LANGWATCH_ENDPOINT environment variables.
   */
  langwatch?:
    | {
        /**
         * LangWatch API key for authentication.
         * Defaults to LANGWATCH_API_KEY environment variable.
         *
         * @example "sk-lw-1234567890abcdef"
         * @default LANGWATCH_API_KEY environment variable
         */
        apiKey?: string;

        /**
         * LangWatch endpoint URL for sending traces and logs.
         * Defaults to LANGWATCH_ENDPOINT environment variable or production endpoint.
         *
         * @default "https://app.langwatch.ai"
         * @default LANGWATCH_ENDPOINT environment variable
         */
        endpoint?: string;

        /**
         * Type of span processor to use for LangWatch exporter.
         *
         * - 'simple': Exports spans immediately (good for debugging)
         * - 'batch': Batches spans for better performance (recommended for production)
         *
         * @default 'batch'
         */
        processorType?: "simple" | "batch";
      }
    | "disabled";

  /**
   * Name of the service being instrumented.
   * Used to identify your service in traces, logs, and metrics.
   *
   * @example "user-service"
   */
  serviceName?: string;

  /**
   * Global attributes added to all telemetry data.
   * Useful for adding service-level metadata like version, environment, etc.
   *
   * @example { "service.version": "1.0.0", "deployment.environment": "production" }
   */
  attributes?: SemConvAttributes;

  /**
   * Configuration for automatic input/output data capture by LangWatch
   * instrumentations: a simple mode string ("all" | "input" | "output" |
   * "none"), a configuration object, or a context-based predicate function.
   * @example dataCapture: (context) => context.operationName.includes("password") ? "none" : "all"
   * @default "all"
   */
  dataCapture?: DataCaptureOptions;

  /**
   * Dedicated TracerProvider for complete trace isolation from other OTel
   * SDKs: LangWatch attaches its exporter here and never touches the global
   * provider, so another SDK sharing the process never sees LLM traces.
   * @remarks Trace-only — log export needs the default setup instead.
   * @example new NodeTracerProvider()
   */
  tracerProvider?: TracerProvider;

  /**
   * Custom trace exporter for sending spans to external systems.
   * If not provided, LangWatch will create its own exporter.
   * This is a simpler alternative to spanProcessors for single exporter use cases.
   *
   * @example new OTLPTraceExporter({ url: "https://custom-collector.com/v1/traces" })
   */
  traceExporter?: SpanExporter;

  /**
   * Custom span processors for advanced trace processing.
   * Use this when you need full control over batching, filtering, or
   * custom processing logic.
   *
   * @example [new SimpleSpanProcessor(new LangWatchExporter())]
   * @example [new BatchSpanProcessor(exporter, { maxExportBatchSize: 100 })]
   */
  spanProcessors?: SpanProcessor[];

  /**
   * Span limits configuration.
   * Controls the maximum number of attributes, events, and links per span.
   *
   * @example { attributeCountLimit: 128, eventCountLimit: 128 }
   */
  spanLimits?: SpanLimits;

  /**
   * Sampling strategy for controlling which traces to collect.
   *
   * @example new TraceIdRatioBasedSampler(0.1) // Sample 10% of traces
   */
  sampler?: Sampler;

  /**
   * Custom ID generator for span and trace IDs.
   *
   * @example new RandomIdGenerator()
   */
  idGenerator?: IdGenerator;

  /**
   * Custom log record processors for advanced log processing.
   * Use this when you need full control over batching, filtering, or
   * custom processing logic.
   *
   * @example [new BatchLogRecordProcessor({ exporter, maxExportBatchSize: 100 })]
   */
  logRecordProcessors?: LogRecordProcessor[];

  /**
   * Custom metric reader for collecting and exporting metrics.
   *
   * @example new PeriodicExportingMetricReader({ exporter: new PrometheusExporter() })
   */
  metricReader?: IMetricReader;

  /**
   * Metric views for controlling aggregation and filtering.
   * Views determine which metrics are collected and how they are processed.
   *
   * @example [{ instrumentName: 'http.server.duration', aggregation: Aggregation.Histogram() }]
   */
  views?: ViewOptions[];

  /**
   * Auto-instrumentation libraries to enable.
   * These automatically capture telemetry from common libraries and frameworks.
   *
   * @example [new HttpInstrumentation(), new ExpressInstrumentation()]
   */
  instrumentations?: (Instrumentation | Instrumentation[])[];

  /**
   * Whether to automatically detect and configure resource attributes.
   * When enabled, OpenTelemetry automatically detects host, process, and environment info.
   *
   * @default true
   */
  autoDetectResources?: boolean;

  /**
   * Custom context manager for managing trace context across async operations.
   */
  contextManager?: ContextManager;

  /**
   * Text map propagator for trace context propagation across service boundaries.
   * Controls how trace context is serialized in HTTP headers and other carriers.
   *
   * @example new W3CTraceContextPropagator()
   */
  textMapPropagator?: TextMapPropagator;

  /**
   * Resource detectors for automatic resource attribute detection.
   * These detect information about the runtime environment.
   *
   * @example [envDetector, processDetector, hostDetector]
   */
  resourceDetectors?: Array<ResourceDetector>;

  /**
   * Custom resource configuration representing the entity being monitored.
   * Includes service, host, and deployment metadata.
   *
   * @example new Resource({ "service.name": "my-service", "service.version": "1.0.0" })
   */
  resource?: Resource;

  /**
   * Debug and development options.
   * These control console output and SDK internal logging behavior.
   */
  debug?: {
    /**
     * Enable console output for traces (debugging).
     * When true, spans will be logged to the console in addition
     * to any other configured exporters.
     *
     * @default false
     */
    consoleTracing?: boolean;

    /**
     * Enable console output for logs (debugging).
     * When true, log records will be logged to the console in addition
     * to any other configured exporters.
     *
     * @default false
     */
    consoleLogging?: boolean;

    /**
     * Log level for LangWatch SDK internal logging.
     * Controls verbosity of SDK diagnostic messages.
     *
     * @default 'warn'
     */
    logLevel?: "debug" | "info" | "warn" | "error";

    /**
     * Custom logger for LangWatch SDK internal logging.
     * If not provided, a console logger will be used.
     */
    logger?: Logger;
  };

  /**
   * Advanced and potentially unsafe configuration options.
   * These options are for special use cases and should be used with caution.
   */
  advanced?: {
    /**
     * Whether to throw errors during setup or return no-op handles. When
     * false (default), setup errors are logged but no-op handles are
     * returned instead, so a setup failure never breaks your application.
     * @default false
     */
    throwOnSetupError?: boolean;

    /**
     * Skip OpenTelemetry setup entirely and return no-op handles.
     * Useful when you want to handle OpenTelemetry setup yourself.
     *
     * @default false
     */
    skipOpenTelemetrySetup?: boolean;

    /**
     * Force reinitialization of OpenTelemetry even if already set up.
     *
     * WARNING: This can cause conflicts and is primarily intended for testing.
     * Use with extreme caution in production.
     *
     * @default false
     */
    UNSAFE_forceOpenTelemetryReinitialization?: boolean;

    /**
     * Attach LangWatch processors to an existing global TracerProvider
     * instead of returning a no-op when another OTel-based SDK already
     * initialized one. Combine with LangWatchTraceExporter filter options to
     * scope LangWatch to only LLM-related spans.
     *
     * @default false
     */
    attachToExistingProvider?: boolean;

    /**
     * Disable all observability setup and return no-op handles. Useful for
     * testing or when you want to disable observability without changing code.
     *
     * @default false
     */
    disabled?: boolean;

    /**
     * Disable the automatic shutdown of the observability system on
     * `beforeExit` / `SIGINT` / `SIGTERM`. The SDK flushes then stands aside
     * rather than terminating your process — except when its handler is the
     * only listener for a signal, when it re-raises the signal so the process
     * still ends. `process.exit()` (e.g. vitest) bypasses these handlers.
     * @default false
     */
    disableAutoShutdown?: boolean;

    /**
     * Exit the process with status 0 as soon as the automatic shutdown has
     * flushed. WARNING: this cuts off any other in-flight `SIGINT`/`SIGTERM`
     * listener (queue drains, writes) and reports success regardless. Leave
     * it off unless your process now fails to exit on a signal; ignored when
     * `disableAutoShutdown` is set.
     * @default false
     */
    UNSAFE_exitProcessAfterAutoShutdown?: boolean;
  };
}

/**
 * Handle returned from observability setup. Use the `shutdown` function
 * yourself when automatic shutdown is disabled, or process signals aren't
 * available (e.g. test runners that call `process.exit()`).
 *
 * @example const { shutdown } = setupObservability({ advanced: { disableAutoShutdown: true } });
 */
export interface ObservabilityHandle {
  /**
   * Gracefully shuts down the observability system: flushes pending traces,
   * closes the exporter, shuts down the tracer provider, and cleans up
   * registered instrumentations. Call it when the application is terminating.
   *
   * @returns Promise that resolves when shutdown is complete
   * @example process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
   */
  shutdown: () => Promise<void>;
}
