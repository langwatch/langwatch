import type { MeterProvider } from '@opentelemetry/api';
import type { IOtlpExportDelegate } from '@opentelemetry/otlp-exporter-base';
import { ExporterMetrics } from '@opentelemetry/otlp-exporter-base';
import type { IExporterMetricsHelper, ISerializer } from '@opentelemetry/otlp-transformer';
import type { OtlpGrpcConfiguration } from './configuration/otlp-grpc-configuration';
export declare function createOtlpGrpcExporterMetrics<Internal>(metricsComponentType: string, exporterMetricsHelper: IExporterMetricsHelper<Internal>, url: string | undefined, meterProvider: MeterProvider | undefined): ExporterMetrics<Internal>;
export declare function createOtlpGrpcExportDelegate<Internal, Response>(options: OtlpGrpcConfiguration, serializer: ISerializer<Internal, Response>, metricsComponentType: string, exporterMetricsHelper: IExporterMetricsHelper<Internal>, meterProvider: MeterProvider | undefined, grpcName: string, grpcPath: string): IOtlpExportDelegate<Internal>;
//# sourceMappingURL=otlp-grpc-export-delegate.d.ts.map