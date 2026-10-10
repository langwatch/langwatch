import {
  type ContextManager,
  type TextMapPropagator,
  type TracerProvider,
} from "@opentelemetry/api";
import { type Instrumentation } from "@opentelemetry/instrumentation";
import { type Resource, type ResourceDetector } from "@opentelemetry/resources";
import { type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { type IMetricReader, type ViewOptions } from "@opentelemetry/sdk-metrics";
import {
  type SpanExporter,
  type SpanProcessor,
  type Sampler,
  type SpanLimits,
  type IdGenerator,
} from "@opentelemetry/sdk-trace-base";

import { type Logger } from "../../../logger";
import { type DataCaptureOptions } from "../../features/data-capture/types";
import { type SemConvAttributes } from "../../semconv";

/**
 * Configuration options for setting up LangWatch observability.
 * See the docs for example configuration and field-by-field details.
 */
export interface SetupObservabilityOptions {
  /**
   * LangWatch config for sending data; 'disabled' turns it off. apiKey/
   * endpoint default from LANGWATCH_API_KEY / LANGWATCH_ENDPOINT.
   */
  langwatch?:
    | {
        /**
         * LangWatch API key for authentication.
         * @default LANGWATCH_API_KEY environment variable
         */
        apiKey?: string;

        /**
         * LangWatch endpoint for traces and logs.
         * @default LANGWATCH_ENDPOINT env var, else "https://app.langwatch.ai"
         */
        endpoint?: string;

        /**
         * Span processor type: 'simple' exports immediately (debugging),
         * 'batch' batches for throughput (recommended for production).
         * @default 'batch'
         */
        processorType?: "simple" | "batch";
      }
    | "disabled";

  /**
   * Name of the service being instrumented, for identification in
   * traces, logs, and metrics.
   */
  serviceName?: string;

  /**
   * Global attributes added to all telemetry data (e.g. service version,
   * deployment environment).
   */
  attributes?: SemConvAttributes;

  /**
   * Automatic input/output data capture: a mode string ("all" | "input" |
   * "output" | "none"), a config object, or a context-based predicate.
   * @default "all"
   */
  dataCapture?: DataCaptureOptions;

  /**
   * Dedicated TracerProvider for isolation from other OTel SDKs: LangWatch
   * attaches its exporter here without touching the global provider, so
   * another SDK sharing the process never sees LLM traces (trace-only).
   */
  tracerProvider?: TracerProvider;

  /**
   * Custom trace exporter for external systems; LangWatch creates its own
   * if omitted. Simpler than spanProcessors for a single exporter.
   */
  traceExporter?: SpanExporter;

  /**
   * Custom span processors for full control over batching, filtering,
   * or processing logic.
   */
  spanProcessors?: SpanProcessor[];

  /**
   * OTLP protocol this process exports spans with (default "http"). "grpc"
   * refuses to start without a traceExporter or spanProcessors built from
   * the optional peer `@opentelemetry/exporter-trace-otlp-grpc`.
   */
  otlpProtocol?: "http" | "grpc";

  /**
   * Span limits: max attributes, events, and links per span.
   */
  spanLimits?: SpanLimits;

  /**
   * Sampling strategy for controlling which traces to collect.
   */
  sampler?: Sampler;

  /**
   * Custom ID generator for span and trace IDs.
   */
  idGenerator?: IdGenerator;

  /**
   * Custom log record processors for full control over batching,
   * filtering, or processing logic.
   */
  logRecordProcessors?: LogRecordProcessor[];

  /**
   * Custom metric reader for collecting and exporting metrics.
   */
  metricReader?: IMetricReader;

  /**
   * Metric views: control which metrics are collected and how they're
   * aggregated/filtered.
   */
  views?: ViewOptions[];

  /**
   * Auto-instrumentation libraries to enable, capturing telemetry from
   * common libraries and frameworks.
   */
  instrumentations?: (Instrumentation | Instrumentation[])[];

  /**
   * Auto-detect resource attributes (host, process, environment info).
   * @default true
   */
  autoDetectResources?: boolean;

  /**
   * Custom context manager for managing trace context across async operations.
   */
  contextManager?: ContextManager;

  /**
   * Text map propagator: controls how trace context is serialized in
   * HTTP headers and other carriers across service boundaries.
   */
  textMapPropagator?: TextMapPropagator;

  /**
   * Resource detectors for automatic detection of runtime environment
   * attributes.
   */
  resourceDetectors?: ResourceDetector[];

  /**
   * Custom resource configuration for the entity being monitored
   * (service, host, deployment metadata).
   */
  resource?: Resource;

  /**
   * Debug and development options.
   * These control console output and SDK internal logging behavior.
   */
  debug?: {
    /**
     * Log spans to the console in addition to configured exporters.
     * @default false
     */
    consoleTracing?: boolean;

    /**
     * Log records to the console in addition to configured exporters.
     * @default false
     */
    consoleLogging?: boolean;

    /**
     * Log level for LangWatch SDK internal diagnostic messages.
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
     * Throw during setup instead of returning no-op handles; false means
     * a setup failure is logged but never breaks your application.
     * @default false
     */
    throwOnSetupError?: boolean;

    /**
     * Skip OpenTelemetry setup and return no-op handles, for when you
     * set up OpenTelemetry yourself.
     * @default false
     */
    skipOpenTelemetrySetup?: boolean;

    /**
     * Force OpenTelemetry reinitialization even if already set up.
     * WARNING: can cause conflicts; testing only, avoid in production.
     * @default false
     */
    UNSAFE_forceOpenTelemetryReinitialization?: boolean;

    /**
     * Attach LangWatch processors to an existing global TracerProvider
     * instead of no-op'ing when another OTel SDK already initialized one.
     * @default false
     */
    attachToExistingProvider?: boolean;

    /**
     * Disable all observability setup and return no-op handles, for
     * testing or disabling without code changes.
     * @default false
     */
    disabled?: boolean;

    /**
     * Disable auto shutdown on `beforeExit`/`SIGINT`/`SIGTERM` (off by
     * default). The SDK flushes then stands aside, re-raising the signal
     * only if it was the sole listener; `process.exit()` bypasses this.
     */
    disableAutoShutdown?: boolean;

    /**
     * Exit with status 0 once shutdown flushes (off by default). WARNING:
     * cuts off any other in-flight signal listener and reports success
     * regardless; ignored when `disableAutoShutdown` is set.
     */
    UNSAFE_exitProcessAfterAutoShutdown?: boolean;
  };
}

/**
 * Handle returned from observability setup. Call `shutdown` yourself when
 * automatic shutdown is disabled, or signals aren't available (e.g. test
 * runners that call `process.exit()`).
 */
export interface ObservabilityHandle {
  /**
   * Gracefully shuts down: flushes pending traces, closes the exporter,
   * and cleans up instrumentations. Call when the application terminates.
   * @returns Promise that resolves when shutdown is complete
   */
  shutdown: () => Promise<void>;
}
