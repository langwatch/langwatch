import type { ContextManager } from '@opentelemetry/api';
import type { TextMapPropagator } from '@opentelemetry/api';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import type { Resource, ResourceDetector } from '@opentelemetry/resources';
import type { LoggerProvider, LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { IMetricReader, ViewOptions } from '@opentelemetry/sdk-metrics';
import type { Sampler, SpanExporter, SpanLimits, SpanProcessor, IdGenerator } from '@opentelemetry/sdk-trace';
import type { TracerProvider } from '@opentelemetry/sdk-trace';
export interface NodeSDKConfiguration {
    autoDetectResources: boolean;
    contextManager: ContextManager;
    textMapPropagator: TextMapPropagator | null;
    /** @deprecated use logRecordProcessors instead*/
    logRecordProcessor: LogRecordProcessor;
    logRecordProcessors?: LogRecordProcessor[];
    /** @deprecated use metricReaders instead*/
    metricReader: IMetricReader;
    metricReaders?: IMetricReader[];
    views: ViewOptions[];
    instrumentations: (Instrumentation | Instrumentation[])[];
    /**
     * Custom resource to attach to telemetry.
     * It is recommended to merge with the default resource via:
     *
     *     resource: defaultResource().merge(
     *       resourceFromAttributes({ foo: 'bar' })
     *     )
     */
    resource: Resource;
    resourceDetectors: Array<ResourceDetector>;
    sampler: Sampler;
    serviceName?: string;
    /** @deprecated use spanProcessors instead*/
    spanProcessor?: SpanProcessor;
    spanProcessors?: SpanProcessor[];
    traceExporter: SpanExporter;
    spanLimits: SpanLimits;
    idGenerator: IdGenerator;
}
/**
 * @experimental Options for new experimental SDK setup
 */
export interface SDKOptions {
    instrumentations?: (Instrumentation | Instrumentation[])[];
    resourceDetectors?: ResourceDetector[];
    textMapPropagator?: TextMapPropagator | null;
}
export interface SDKComponents {
    contextManager?: ContextManager;
    loggerProvider?: LoggerProvider;
    meterProvider?: MeterProvider;
    tracerProvider?: TracerProvider;
    propagator?: TextMapPropagator;
}
//# sourceMappingURL=types.d.ts.map