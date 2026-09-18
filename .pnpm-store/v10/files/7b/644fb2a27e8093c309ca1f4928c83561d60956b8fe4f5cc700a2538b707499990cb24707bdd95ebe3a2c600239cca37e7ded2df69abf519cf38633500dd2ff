import { type Attributes, type MeterProvider } from '@opentelemetry/api';
import { type IExporterMetricsHelper } from '@opentelemetry/otlp-transformer';
export interface ExporterMetricsOptions<Internal> {
    componentType: string;
    metricsHelper: IExporterMetricsHelper<Internal>;
    url: string | undefined;
    meterProvider: MeterProvider | undefined;
    responseAttributesFromError: (error: Error | string | undefined) => Attributes;
}
/**
 * Generates `otel.sdk.exporter.*` metrics.
 * https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics
 */
export declare class ExporterMetrics<Internal> {
    private readonly inflight;
    private readonly exported;
    private readonly duration;
    private readonly standardAttrs;
    private readonly responseAttributesFromError;
    private readonly helper;
    constructor(options: ExporterMetricsOptions<Internal>);
    startExport(request: Internal): (error: Error | string | undefined) => void;
}
//# sourceMappingURL=ExporterMetrics.d.ts.map