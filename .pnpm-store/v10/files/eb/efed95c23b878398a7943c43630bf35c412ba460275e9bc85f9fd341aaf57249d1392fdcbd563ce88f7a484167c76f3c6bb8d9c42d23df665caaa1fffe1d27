import type { MeterProvider } from '@opentelemetry/api';
import type { IOtlpExportDelegate } from './otlp-export-delegate';
import type { IExporterMetricsHelper, ISerializer } from '@opentelemetry/otlp-transformer';
import type { OtlpNodeHttpConfiguration } from './configuration/otlp-node-http-configuration';
import { ExporterMetrics } from './ExporterMetrics';
export declare function createOtlpHttpExporterMetrics<Internal>(metricsComponentType: string, exporterMetricsHelper: IExporterMetricsHelper<Internal>, url: string | undefined, meterProvider: MeterProvider | undefined): ExporterMetrics<Internal>;
export declare function createOtlpHttpExportDelegate<Internal, Response>(options: OtlpNodeHttpConfiguration, serializer: ISerializer<Internal, Response>, metricsComponentType: string, exporterMetricsHelper: IExporterMetricsHelper<Internal>, meterProvider: MeterProvider | undefined): IOtlpExportDelegate<Internal>;
//# sourceMappingURL=otlp-http-export-delegate.d.ts.map