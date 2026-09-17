import {
  context,
  diag,
  DiagConsoleLogger,
  metrics,
  propagation,
  trace,
  type ContextManager,
  type TextMapPropagator,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
  diagLogLevelFromString,
  getBooleanFromEnv,
  getNumberFromEnv,
  getStringFromEnv,
  getStringListFromEnv,
} from "@opentelemetry/core";
import { registerInstrumentations, type Instrumentation } from "@opentelemetry/instrumentation";
import {
  defaultResource,
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
  type Resource,
  type ResourceDetector,
} from "@opentelemetry/resources";
import { LoggerProvider, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { MeterProvider, type IMetricReader, type ViewOptions } from "@opentelemetry/sdk-metrics";
import {
  type IdGenerator,
  type Sampler,
  type SpanLimits,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { type Logger } from "../../../logger";

/**
 * Everything `@opentelemetry/sdk-node`'s `NodeSDK` was given here, kept
 * name-for-name so the call site reads the same.
 */
export interface NodeSdkConfiguration {
  resource?: Resource;
  serviceName?: string;
  autoDetectResources?: boolean;
  contextManager?: ContextManager;
  textMapPropagator?: TextMapPropagator;
  metricReader?: IMetricReader;
  views?: ViewOptions[];
  resourceDetectors?: ResourceDetector[];
  sampler?: Sampler;
  spanProcessors?: SpanProcessor[];
  logRecordProcessors?: LogRecordProcessor[];
  spanLimits?: SpanLimits;
  idGenerator?: IdGenerator;
  instrumentations?: (Instrumentation | Instrumentation[])[];
  logger: Logger;
}

/** Propagators the spec names that this package can build without a further install. */
const BUILT_IN_PROPAGATORS: Record<string, () => TextMapPropagator> = {
  tracecontext: () => new W3CTraceContextPropagator(),
  baggage: () => new W3CBaggagePropagator(),
};

/** Propagators OTel ships in their own packages, which this SDK does not depend on. */
const SEPARATELY_PACKAGED_PROPAGATORS: Record<string, string> = {
  b3: "@opentelemetry/propagator-b3",
  b3multi: "@opentelemetry/propagator-b3",
  jaeger: "@opentelemetry/propagator-jaeger",
};

const RESOURCE_DETECTORS_BY_ENV_NAME: Record<string, ResourceDetector> = {
  host: hostDetector,
  os: osDetector,
  serviceinstance: serviceInstanceIdDetector,
  process: processDetector,
  env: envDetector,
};

/** `null` means "registered nothing deliberately"; `undefined` means "use the default". */
function setupContextManager(contextManager: ContextManager | null | undefined): void {
  if (contextManager === null) return;

  if (contextManager === undefined) {
    const defaultContextManager = new AsyncLocalStorageContextManager();
    defaultContextManager.enable();
    context.setGlobalContextManager(defaultContextManager);
    return;
  }

  contextManager.enable();
  context.setGlobalContextManager(contextManager);
}

/** `null` means "registered nothing deliberately"; `undefined` means "use the default". */
function setupPropagator(propagator: TextMapPropagator | null | undefined): void {
  if (propagator === null) return;

  if (propagator === undefined) {
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      }),
    );
    return;
  }

  propagation.setGlobalPropagator(propagator);
}

function getPropagatorFromEnv(logger: Logger): TextMapPropagator | null | undefined {
  const requested = getStringListFromEnv("OTEL_PROPAGATORS");
  if (requested == null) return void 0;
  if (requested.includes("none")) return null;

  const built: TextMapPropagator[] = [];
  const uniqueNames = Array.from(new Set(requested));

  for (const name of uniqueNames) {
    const propagator = BUILT_IN_PROPAGATORS[name]?.();
    if (propagator) {
      built.push(propagator);
      continue;
    }

    const separatePackage = SEPARATELY_PACKAGED_PROPAGATORS[name];
    logger.warn(
      separatePackage
        ? `OTEL_PROPAGATORS asks for "${name}", which lives in ${separatePackage}. LangWatch does not build it; construct it yourself and pass it as textMapPropagator, or trace context will not travel as "${name}".`
        : `Propagator "${name}" requested through the environment variable OTEL_PROPAGATORS is unavailable.`,
    );
  }

  if (built.length === 0) return null;
  if (built.length === 1) return built[0];
  return new CompositePropagator({ propagators: built });
}

function getResourceDetectorsFromEnv(logger: Logger): ResourceDetector[] {
  const requested = getStringListFromEnv("OTEL_NODE_RESOURCE_DETECTORS") ?? ["all"];
  if (requested.includes("all")) return Object.values(RESOURCE_DETECTORS_BY_ENV_NAME);
  if (requested.includes("none")) return [];

  return requested.flatMap((name) => {
    const detector = RESOURCE_DETECTORS_BY_ENV_NAME[name];
    if (!detector) {
      logger.warn(
        `Invalid resource detector "${name}" specified in the environment variable OTEL_NODE_RESOURCE_DETECTORS`,
      );
      return [];
    }
    return [detector];
  });
}

function getLogRecordLimitsFromEnv() {
  return {
    attributeCountLimit:
      getNumberFromEnv("OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT") ??
      getNumberFromEnv("OTEL_ATTRIBUTE_COUNT_LIMIT"),
    attributeValueLengthLimit:
      getNumberFromEnv("OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT") ??
      getNumberFromEnv("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"),
  };
}

/**
 * The telemetry graph this SDK registers with the OpenTelemetry API, built
 * from `@opentelemetry/sdk-trace-node` so no OTLP exporter -- and so no
 * gRPC -- is loaded for a process that never asked for one.
 */
export class NodeSdk {
  private readonly configuration: NodeSdkConfiguration;
  private readonly instrumentations: Instrumentation[];
  private readonly disabled: boolean;

  private tracerProvider: NodeTracerProvider | undefined;
  private loggerProvider: LoggerProvider | undefined;
  private meterProvider: MeterProvider | undefined;

  constructor(configuration: NodeSdkConfiguration) {
    this.disabled = getBooleanFromEnv("OTEL_SDK_DISABLED");

    const logLevel = getStringFromEnv("OTEL_LOG_LEVEL");
    if (logLevel != null) {
      diag.setLogger(new DiagConsoleLogger(), { logLevel: diagLogLevelFromString(logLevel) });
    }

    this.configuration = configuration;
    this.instrumentations = configuration.instrumentations?.flat() ?? [];
  }

  /** Registers instrumentations, context manager, propagator and providers, in that order. */
  start(): void {
    if (this.disabled) return;

    registerInstrumentations({ instrumentations: this.instrumentations });
    setupContextManager(this.configuration.contextManager);
    setupPropagator(
      this.configuration.textMapPropagator ?? getPropagatorFromEnv(this.configuration.logger),
    );

    const resource = this.resolveResource();
    this.startMeterProvider(resource);
    this.startTracerProvider(resource);
    this.startLoggerProvider(resource);
  }

  /** Flushes and closes every provider this instance registered. */
  async shutdown(): Promise<void> {
    const shutdowns: Promise<void>[] = [];
    if (this.tracerProvider) shutdowns.push(this.tracerProvider.shutdown());
    if (this.loggerProvider) shutdowns.push(this.loggerProvider.shutdown());
    if (this.meterProvider) shutdowns.push(this.meterProvider.shutdown());
    await Promise.all(shutdowns);
  }

  private startMeterProvider(resource: Resource): void {
    const reader = this.configuration.metricReader;
    if (!reader) return;

    this.meterProvider = new MeterProvider({
      resource,
      views: this.configuration.views ?? [],
      readers: [reader],
    });
    metrics.setGlobalMeterProvider(this.meterProvider);

    // Instrumentations registered before a MeterProvider exists drop every
    // metric they record, so hand them the one just registered.
    for (const instrumentation of this.instrumentations) {
      instrumentation.setMeterProvider(metrics.getMeterProvider());
    }
  }

  private startTracerProvider(resource: Resource): void {
    const spanProcessors = this.configuration.spanProcessors ?? [];

    // No processor means nowhere for spans to go: registering a provider
    // would only claim the global slot and drop everything sent to it.
    if (spanProcessors.length === 0) return;

    this.tracerProvider = new NodeTracerProvider({
      sampler: this.configuration.sampler,
      spanLimits: this.configuration.spanLimits,
      resource,
      idGenerator: this.configuration.idGenerator,
      spanProcessors,
    });
    trace.setGlobalTracerProvider(this.tracerProvider);
  }

  private startLoggerProvider(resource: Resource): void {
    const processors = this.configuration.logRecordProcessors;
    if (!processors) return;

    this.loggerProvider = new LoggerProvider({
      logRecordLimits: getLogRecordLimitsFromEnv(),
      resource,
      processors,
    });
    logs.setGlobalLoggerProvider(this.loggerProvider);
  }

  private resolveResource(): Resource {
    let resource = this.configuration.resource ?? defaultResource();

    if (this.configuration.autoDetectResources ?? true) {
      resource = resource.merge(detectResources({ detectors: this.resolveResourceDetectors() }));
    }

    // Re-applied after detection so an explicit serviceName still wins over
    // whatever OTEL_SERVICE_NAME or a detector put in service.name.
    return this.configuration.serviceName === undefined
      ? resource
      : resource.merge(
          resourceFromAttributes({ [ATTR_SERVICE_NAME]: this.configuration.serviceName }),
        );
  }

  private resolveResourceDetectors(): ResourceDetector[] {
    if (this.configuration.resourceDetectors != null) return this.configuration.resourceDetectors;
    if (getStringFromEnv("OTEL_NODE_RESOURCE_DETECTORS")) {
      return getResourceDetectorsFromEnv(this.configuration.logger);
    }
    return [envDetector, processDetector, hostDetector];
  }
}
