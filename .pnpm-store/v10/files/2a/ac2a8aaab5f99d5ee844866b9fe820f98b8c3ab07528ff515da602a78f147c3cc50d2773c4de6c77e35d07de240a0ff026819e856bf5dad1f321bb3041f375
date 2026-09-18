/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createOtlpExportDelegate } from './otlp-export-delegate';
import { createHttpExporterTransport } from './transport/http-exporter-transport';
import { createBoundedQueueExportPromiseHandler } from './bounded-queue-export-promise-handler';
import { createRetryingTransport } from './retrying-transport';
import { OTLPExporterError } from './types';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from './semconv';
import { ExporterMetrics } from './ExporterMetrics';
export function createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
    return new ExporterMetrics({
        componentType: metricsComponentType,
        metricsHelper: exporterMetricsHelper,
        url,
        meterProvider,
        responseAttributesFromError: (error) => {
            if (!error) {
                return {
                    [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
                };
            }
            if (!(error instanceof OTLPExporterError)) {
                return {};
            }
            return {
                [ATTR_HTTP_RESPONSE_STATUS_CODE]: error.code,
            };
        },
    });
}
export function createOtlpHttpExportDelegate(options, serializer, metricsComponentType, exporterMetricsHelper, meterProvider) {
    return createOtlpExportDelegate({
        transport: createRetryingTransport({
            transport: createHttpExporterTransport(options),
        }),
        serializer: serializer,
        promiseHandler: createBoundedQueueExportPromiseHandler(options),
        metrics: createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, meterProvider),
    }, { timeout: options.timeoutMillis });
}
//# sourceMappingURL=otlp-http-export-delegate.js.map