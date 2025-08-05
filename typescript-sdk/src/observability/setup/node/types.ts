import { Logger } from "../../../logger";
import { Attributes, AttributeValue, TracerProvider } from "@opentelemetry/api";
import { Instrumentation } from "@opentelemetry/instrumentation";
import { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ContextManager, TextMapPropagator } from "@opentelemetry/api";
import { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { IMetricReader } from "@opentelemetry/sdk-metrics";
import { ViewOptions } from "@opentelemetry/sdk-metrics";
import { Resource, ResourceDetector } from "@opentelemetry/resources";
import { Sampler, SpanLimits } from "@opentelemetry/sdk-trace-base";
import { IdGenerator } from "@opentelemetry/sdk-trace-base";
import { LangWatchTracer } from "../../tracer";
import * as langwatchAttributes from "../../semconv/attributes";
import * as semconvAttributes from "@opentelemetry/semantic-conventions/incubating";

/**
 * Union type representing all possible attribute keys that can be used in spans.
 *
 * This includes:
 * - Standard OpenTelemetry semantic convention attributes
 * - LangWatch-specific attributes
 * - Custom string attributes
 *
 * @example
 * ```typescript
 * const attributes: SemconvAttributes = {
 *   "http.method": "GET",
 *   "http.url": "https://api.example.com",
 *   "langwatch.span.type": "llm",
 *   "custom.attribute": "value"
 * };
 * ```
 */
export type AttributeKey = keyof typeof semconvAttributes | keyof typeof langwatchAttributes | (string & {});

/**
 * Record type representing span attributes with semantic convention keys.
 *
 * This type ensures type safety when setting attributes on spans while
 * allowing both standard OpenTelemetry semantic conventions and custom attributes.
 *
 * @example
 * ```typescript
 * const spanAttributes: SemconvAttributes = {
 *   "service.name": "my-service",
 *   "service.version": "1.0.0",
 *   "langwatch.span.type": "llm",
 *   "custom.user.id": "user123"
 * };
 * ```
 */
export type SemconvAttributes = Record<AttributeKey, AttributeValue>;

/**
 * Configuration options for setting up LangWatch observability.
 *
 * This interface provides comprehensive configuration for initializing
 * LangWatch tracing with both basic and advanced OpenTelemetry options.
 *
 * @example
 * ```typescript
 * const options: SetupObservabilityOptions = {
 *   apiKey: "your-api-key",
 *   serviceName: "my-service",
 *   attributes: {
 *     "service.version": "1.0.0",
 *     "deployment.environment": "production"
 *   },
 *   debug: true,
 * };
 * ```
 */
export interface SetupObservabilityOptions {
  /**
   * LangWatch API key for authentication.
   *
   * Required for sending traces to LangWatch. Can also be set via
   * the `LANGWATCH_API_KEY` environment variable.
   *
   * @example "sk-lw-1234567890abcdef"
   */
  apiKey?: string;

  /**
   * LangWatch endpoint URL for sending traces.
   *
   * Defaults to the production LangWatch endpoint. Can also be set via
   * the `LANGWATCH_ENDPOINT` environment variable.
   *
   * @example "https://api.langwatch.ai"
   * @default "https://api.langwatch.ai"
   */
  endpoint?: string;

  /**
   * Name of the service being instrumented.
   *
   * This will be used as the service name in traces and metrics.
   * Can also be set via the `LANGWATCH_SERVICE_NAME` environment variable.
   *
   * @example "user-service"
   */
  serviceName?: string;

  /**
   * Global attributes to be added to all spans created by this tracer.
   *
   * These attributes will be merged with any attributes set on individual spans.
   * Useful for adding service-level metadata like version, environment, etc.
   *
   * @example
   * ```typescript
   * attributes: {
   *   "service.version": "1.0.0",
   *   "deployment.environment": "production",
   *   "team.name": "backend"
   * }
   * ```
   */
  attributes?: SemconvAttributes;

  /**
   * Enable debug logging for troubleshooting.
   *
   * When enabled, detailed logs about trace processing and configuration
   * will be output to the console.
   *
   * @default false
   */
  debug?: boolean;

  /**
   * Custom logger instance for LangWatch internal logging.
   *
   * If not provided, LangWatch will use a default console logger.
   * Useful for integrating with existing logging infrastructure.
   *
   * @example
   * ```typescript
   * logger: {
   *   debug: (msg) => myLogger.debug(msg),
   *   info: (msg) => myLogger.info(msg),
   *   warn: (msg) => myLogger.warn(msg),
   *   error: (msg) => myLogger.error(msg)
   * }
   * ```
   */
  logger?: Logger;

  /**
   * Custom OpenTelemetry TracerProvider instance.
   *
   * If provided, LangWatch will use this provider instead of creating
   * its own. Useful for advanced OpenTelemetry configurations.
   */
  tracerProvider?: TracerProvider;

  /**
   * OpenTelemetry instrumentations to register with the tracer.
   *
   * These instrumentations will automatically create spans for common
   * operations like HTTP requests, database queries, etc.
   *
   * @example
   * ```typescript
   * instrumentations: [
   *   new HttpInstrumentation(),
   *   new ExpressInstrumentation(),
   *   new MongoDBInstrumentation()
   * ]
   * ```
   */
  instrumentations?: (Instrumentation | Instrumentation[])[];

  /**
   * Custom span processors for trace processing pipeline.
   *
   * Span processors handle tasks like batching, filtering, and
   * custom processing of spans before they are exported.
   *
   * @example
   * ```typescript
   * spanProcessors: [
   *   new BatchSpanProcessor(exporter),
   *   new SimpleSpanProcessor(consoleExporter)
   * ]
   * ```
   */
  spanProcessors?: SpanProcessor[];

  /**
   * Custom trace exporter for sending spans to external systems.
   *
   * If not provided, LangWatch will create its own OTLP exporter
   * configured for the LangWatch endpoint.
   *
   * @example
   * ```typescript
   * traceExporter: new OTLPTraceExporter({
   *   url: "https://custom-collector.com/v1/traces"
   * })
   * ```
   */
  traceExporter?: OTLPTraceExporter;

  /**
   * Whether to override the global OpenTelemetry tracer provider.
   *
   * When true, LangWatch will set its tracer provider as the global
   * default. This affects other libraries that use OpenTelemetry.
   *
   * @default true
   */
  overrideGlobal?: boolean;

  // Advanced OTEL passthrough

  /**
   * Whether to automatically detect and configure resources.
   *
   * When enabled, OpenTelemetry will automatically detect information
   * about the host, process, and deployment environment.
   *
   * @default true
   */
  autoDetectResources?: boolean;

  /**
   * Custom context manager for managing trace context.
   *
   * The context manager handles how trace context is propagated
   * across async operations and between different execution contexts.
   */
  contextManager?: ContextManager;

  /**
   * Custom text map propagator for trace context propagation.
   *
   * Controls how trace context is serialized and deserialized
   * when propagating across service boundaries (e.g., HTTP headers).
   *
   * @example
   * ```typescript
   * textMapPropagator: new W3CTraceContextPropagator()
   * ```
   */
  textMapPropagator?: TextMapPropagator;

  /**
   * Custom log record processors for log processing pipeline.
   *
   * These processors handle tasks like batching and filtering
   * of log records before they are exported.
   */
  logRecordProcessors?: LogRecordProcessor[];

  /**
   * Custom metric reader for collecting and exporting metrics.
   *
   * Controls how metrics are collected and sent to external systems.
   *
   * @example
   * ```typescript
   * metricReader: new PeriodicExportingMetricReader({
   *   exporter: new OTLPMetricExporter()
   * })
   * ```
   */
  metricReader?: IMetricReader;

  /**
   * Custom metric views for aggregating and filtering metrics.
   *
   * Views control which metrics are collected and how they are
   * aggregated before being exported.
   *
   * @example
   * ```typescript
   * views: [
   *   {
   *     instrumentName: "http.server.duration",
   *     aggregation: AggregationTemporality.CUMULATIVE
   *   }
   * ]
   * ```
   */
  views?: ViewOptions[];

  /**
   * Custom resource configuration for the service.
   *
   * The resource represents the entity being monitored (e.g., service,
   * host, deployment) and its associated metadata.
   *
   * @example
   * ```typescript
   * resource: new Resource({
   *   "service.name": "my-service",
   *   "service.version": "1.0.0",
   *   "deployment.environment": "production"
   * })
   * ```
   */
  resource?: Resource;

  /**
   * Custom resource detectors for automatic resource detection.
   *
   * These detectors automatically discover information about the
   * runtime environment, host, and deployment.
   *
   * @example
   * ```typescript
   * resourceDetectors: [
   *   new HostDetector(),
   *   new ProcessDetector(),
   *   new ContainerDetector()
   * ]
   * ```
   */
  resourceDetectors?: Array<ResourceDetector>;

  /**
   * Custom sampler for controlling trace sampling decisions.
   *
   * The sampler determines which traces are recorded and exported
   * based on sampling policies and rates.
   *
   * @example
   * ```typescript
   * sampler: new TraceIdRatioBasedSampler(0.1) // 10% sampling
   * ```
   */
  sampler?: Sampler;

  /**
   * Custom span limits for controlling span behavior.
   *
   * Controls limits on span attributes, events, and links to
   * prevent excessive memory usage.
   *
   * @example
   * ```typescript
   * spanLimits: {
   *   attributeCountLimit: 128,
   *   eventCountLimit: 128,
   *   linkCountLimit: 128
   * }
   * ```
   */
  spanLimits?: SpanLimits;

  /**
   * Custom ID generator for creating trace and span IDs.
   *
   * Controls how unique identifiers are generated for traces
   * and spans. Useful for testing or custom ID formats.
   *
   * @example
   * ```typescript
   * idGenerator: new RandomIdGenerator()
   * ```
   */
  idGenerator?: IdGenerator;
}

/**
 * Handle returned from observability setup containing the tracer and shutdown function.
 *
 * This interface provides access to the configured LangWatch tracer and a method
 * to properly shut down the observability system when the application terminates.
 *
 * @example
 * ```typescript
 * const { tracer, shutdown } = await setupObservability(options);
 *
 * // Use the tracer for creating spans
 * const span = tracer.startSpan("my-operation");
 *
 * // Shutdown when the application is terminating
 * process.on('SIGTERM', async () => {
 *   await shutdown();
 *   process.exit(0);
 * });
 * ```
 */
export interface ObservabilityHandle {
  /**
   * Configured LangWatch tracer instance.
   *
   * This tracer is pre-configured with the LangWatch endpoint and
   * can be used to create spans, add attributes, and record events.
   *
   * @example
   * ```typescript
   * const span = tracer.startSpan("database-query");
   * span.setAttribute("db.system", "postgresql");
   * span.setAttribute("db.statement", "SELECT * FROM users");
   *
   * try {
   *   const result = await queryDatabase();
   *   span.setStatus({ code: SpanStatusCode.OK });
   *   return result;
   * } catch (error) {
   *   span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
   *   throw error;
   * } finally {
   *   span.end();
   * }
   * ```
   */
  tracer: LangWatchTracer;

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
