import { type Logger } from "../../../logger";
import { type Instrumentation } from "@opentelemetry/instrumentation";
import { type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { type ContextManager, type TextMapPropagator } from "@opentelemetry/api";
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
 *
 * This interface provides comprehensive configuration for initializing
 * LangWatch tracing with a familiar flat structure for main options
 * and grouped sections for debug and advanced configuration.
 *
 * @example
 * ```typescript
 * const options: SetupObservabilityOptions = {
 *   langwatch: {
 *     apiKey: "sk-lw-1234567890abcdef"
 *   },
 *   serviceName: "my-service",
 *   attributes: {
 *     "service.version": "1.0.0",
 *     "deployment.environment": "production"
 *   },
 *   spanProcessors: [new BatchSpanProcessor(new JaegerExporter())],
 *   debug: {
 *     consoleTracing: true,
 *     logLevel: 'debug'
 *   }
 * };
 * ```
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
         * @default 'simple'
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
   * Configuration for automatic data capture.
   *
   * This provides control over input/output data capture by LangWatch instrumentations.
   * You can use a simple string mode, a configuration object, or a predicate function
   * for dynamic control based on the operation context.
   *
   * @example
   * ```typescript
   * // Simple mode - capture everything
   * dataCapture: "all"
   *
   * // Simple mode - capture only input data
   * dataCapture: "input"
   *
   * // Simple mode - capture only output data
   * dataCapture: "output"
   *
   * // Simple mode - capture nothing
   * dataCapture: "none"
   *
   * // Configuration object
   * dataCapture: {
   *   mode: "all"
   * }
   *
   * // Dynamic predicate function
   * dataCapture: (context) => {
   *   // Don't capture sensitive data in production
   *   if (context.environment === "production" &&
   *       context.operationName.includes("password")) {
   *     return "none";
   *   }
   *   // Capture everything else
   *   return "all";
   * }
   * ```
   *
   * @default "all"
   */
  dataCapture?: DataCaptureOptions;

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
   * @example [new BatchLogRecordProcessor(exporter, { maxExportBatchSize: 100 })]
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
     * Whether to throw errors during setup or return no-op handles.
     *
     * When false (default), setup errors are logged but the function
     * returns no-op handles to prevent breaking your application.
     * When true, setup errors will be thrown.
     *
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
     * Disable all observability setup and return no-op handles.
     *
     * When true, no OpenTelemetry setup will occur and all operations
     * will be no-ops. Useful for testing or when you want to completely
     * disable observability without changing your code.
     *
     * @default false
     */
    disabled?: boolean;

    /**
     * Disable the automatic shutdown of the observability system when the application
     * terminates.
     *
     * When enabled (default), the SDK registers handlers for `beforeExit` (event loop
     * drains), `SIGINT` (Ctrl+C), and `SIGTERM` (external kill / Docker stop) to flush
     * pending traces before the process exits.
     *
     * Note: `process.exit()` calls (e.g. from test runners like vitest) bypass these
     * handlers. In those environments, call `shutdown()` explicitly in your teardown.
     *
     * @default false
     */
    disableAutoShutdown?: boolean;
  };
}

/**
 * Handle returned from observability setup. If you disable the automatic shutdown,
 * or are running in an environment where process signals are not available (e.g.
 * test runners that call `process.exit()`), you can use the shutdown function to
 * manually shut down the observability system and ensure that no data is lost.
 *
 * @example
 * ```typescript
 * const { shutdown } = setupObservability({
 *   advanced: { disableAutoShutdown: true }
 * });
 *
 * // Manual shutdown in test teardown
 * afterAll(async () => {
 *   await shutdown();
 * });
 * ```
 */
export interface ObservabilityHandle {
  /**
   * Gracefully shuts down the observability system.
   *
   * This method should be called when the application is terminating
   * to ensure all pending traces are exported before shutdown.
   *
   * The shutdown process:
   * 1. Flushes any pending traces to the exporter
   * 2. Closes the trace exporter
   * 3. Shuts down the tracer provider
   * 4. Cleans up any registered instrumentations
   *
   * @returns Promise that resolves when shutdown is complete
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down observability...');
   *   await shutdown();
   *   console.log('Observability shutdown complete');
   *   process.exit(0);
   * });
   *
   * // Force shutdown with timeout
   * process.on('SIGINT', async () => {
   *   console.log('Force shutdown...');
   *   await Promise.race([
   *     shutdown(),
   *     new Promise(resolve => setTimeout(resolve, 5000))
   *   ]);
   *   process.exit(1);
   * });
   * ```
   */
  shutdown: () => Promise<void>;
}
