"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOtlpGrpcExportDelegate = exports.createOtlpGrpcExporterMetrics = void 0;
const otlp_exporter_base_1 = require("@opentelemetry/otlp-exporter-base");
const grpc_exporter_transport_1 = require("./grpc-exporter-transport");
const semconv_1 = require("./semconv");
function createOtlpGrpcExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
    return new otlp_exporter_base_1.ExporterMetrics({
        componentType: metricsComponentType,
        metricsHelper: exporterMetricsHelper,
        url,
        meterProvider,
        responseAttributesFromError: (error) => {
            if (!error) {
                return {
                    [semconv_1.ATTR_RPC_RESPONSE_STATUS_CODE]: 'OK',
                };
            }
            if (!isServiceError(error)) {
                return {};
            }
            // Lazy-load so that we don't need to require/import '@grpc/grpc-js' before it can be wrapped by instrumentation.
            const { status } = 
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
            require('@grpc/grpc-js');
            const statusName = status[error.code] ?? 'UNKNOWN';
            return {
                [semconv_1.ATTR_RPC_RESPONSE_STATUS_CODE]: statusName,
            };
        },
    });
}
exports.createOtlpGrpcExporterMetrics = createOtlpGrpcExporterMetrics;
function createOtlpGrpcExportDelegate(options, serializer, metricsComponentType, exporterMetricsHelper, meterProvider, grpcName, grpcPath) {
    return (0, otlp_exporter_base_1.createOtlpNetworkExportDelegate)(options, serializer, createOtlpGrpcExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, meterProvider), (0, grpc_exporter_transport_1.createOtlpGrpcExporterTransport)({
        address: options.url,
        compression: options.compression,
        credentials: options.credentials,
        metadata: options.metadata,
        userAgent: options.userAgent,
        grpcName,
        grpcPath,
    }));
}
exports.createOtlpGrpcExportDelegate = createOtlpGrpcExportDelegate;
function isServiceError(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number');
}
//# sourceMappingURL=otlp-grpc-export-delegate.js.map