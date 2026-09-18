"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLegacyOtlpBrowserExportDelegate = exports.createLegacyOtlpBrowserExporterMetrics = void 0;
const otlp_browser_http_export_delegate_1 = require("../otlp-browser-http-export-delegate");
const convert_legacy_browser_http_options_1 = require("./convert-legacy-browser-http-options");
const semconv_1 = require("../semconv");
const ExporterMetrics_1 = require("../ExporterMetrics");
/**
 * @deprecated
 */
function createLegacyOtlpBrowserExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
    return new ExporterMetrics_1.ExporterMetrics({
        componentType: metricsComponentType,
        metricsHelper: exporterMetricsHelper,
        url,
        meterProvider,
        responseAttributesFromError: (error) => {
            if (!error) {
                return {
                    [semconv_1.ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
                };
            }
            if (!(error instanceof Error)) {
                return {};
            }
            if (error.message.startsWith('Fetch request failed with non-retryable status ')) {
                const statusStr = error.message.substring('Fetch request failed with non-retryable status '.length);
                return {
                    [semconv_1.ATTR_HTTP_RESPONSE_STATUS_CODE]: Number(statusStr),
                };
            }
            return {};
        },
    });
}
exports.createLegacyOtlpBrowserExporterMetrics = createLegacyOtlpBrowserExporterMetrics;
/**
 * @deprecated
 * @param config
 * @param serializer
 * @param signalResourcePath
 * @param requiredHeaders
 */
function createLegacyOtlpBrowserExportDelegate(config, serializer, metricsComponentType, exporterMetricsHelper, meterProvider, signalResourcePath, requiredHeaders) {
    const options = (0, convert_legacy_browser_http_options_1.convertLegacyBrowserHttpOptions)(config, signalResourcePath, requiredHeaders);
    return (0, otlp_browser_http_export_delegate_1.createOtlpFetchExportDelegate)(options, serializer, createLegacyOtlpBrowserExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, config.selfObsMeterProvider));
}
exports.createLegacyOtlpBrowserExportDelegate = createLegacyOtlpBrowserExportDelegate;
//# sourceMappingURL=create-legacy-browser-delegate.js.map