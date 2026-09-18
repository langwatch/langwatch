"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOtlpHttpExportDelegate = exports.createOtlpHttpExporterMetrics = void 0;
const otlp_export_delegate_1 = require("./otlp-export-delegate");
const http_exporter_transport_1 = require("./transport/http-exporter-transport");
const bounded_queue_export_promise_handler_1 = require("./bounded-queue-export-promise-handler");
const retrying_transport_1 = require("./retrying-transport");
const types_1 = require("./types");
const semconv_1 = require("./semconv");
const ExporterMetrics_1 = require("./ExporterMetrics");
function createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
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
            if (!(error instanceof types_1.OTLPExporterError)) {
                return {};
            }
            return {
                [semconv_1.ATTR_HTTP_RESPONSE_STATUS_CODE]: error.code,
            };
        },
    });
}
exports.createOtlpHttpExporterMetrics = createOtlpHttpExporterMetrics;
function createOtlpHttpExportDelegate(options, serializer, metricsComponentType, exporterMetricsHelper, meterProvider) {
    return (0, otlp_export_delegate_1.createOtlpExportDelegate)({
        transport: (0, retrying_transport_1.createRetryingTransport)({
            transport: (0, http_exporter_transport_1.createHttpExporterTransport)(options),
        }),
        serializer: serializer,
        promiseHandler: (0, bounded_queue_export_promise_handler_1.createBoundedQueueExportPromiseHandler)(options),
        metrics: createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, meterProvider),
    }, { timeout: options.timeoutMillis });
}
exports.createOtlpHttpExportDelegate = createOtlpHttpExportDelegate;
//# sourceMappingURL=otlp-http-export-delegate.js.map