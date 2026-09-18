/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createOtlpFetchExportDelegate } from '../otlp-browser-http-export-delegate';
import { convertLegacyBrowserHttpOptions } from './convert-legacy-browser-http-options';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from '../semconv';
import { ExporterMetrics } from '../ExporterMetrics';
/**
 * @deprecated
 */
export function createLegacyOtlpBrowserExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
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
            if (!(error instanceof Error)) {
                return {};
            }
            if (error.message.startsWith('Fetch request failed with non-retryable status ')) {
                const statusStr = error.message.substring('Fetch request failed with non-retryable status '.length);
                return {
                    [ATTR_HTTP_RESPONSE_STATUS_CODE]: Number(statusStr),
                };
            }
            return {};
        },
    });
}
/**
 * @deprecated
 * @param config
 * @param serializer
 * @param signalResourcePath
 * @param requiredHeaders
 */
export function createLegacyOtlpBrowserExportDelegate(config, serializer, metricsComponentType, exporterMetricsHelper, meterProvider, signalResourcePath, requiredHeaders) {
    const options = convertLegacyBrowserHttpOptions(config, signalResourcePath, requiredHeaders);
    return createOtlpFetchExportDelegate(options, serializer, createLegacyOtlpBrowserExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, config.selfObsMeterProvider));
}
//# sourceMappingURL=create-legacy-browser-delegate.js.map