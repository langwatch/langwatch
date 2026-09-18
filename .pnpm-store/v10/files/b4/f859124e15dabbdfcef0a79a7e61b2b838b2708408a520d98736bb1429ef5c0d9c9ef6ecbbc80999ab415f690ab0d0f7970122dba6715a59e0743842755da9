"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExporterMetrics = void 0;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const semconv_1 = require("./semconv");
const version_1 = require("./version");
const componentCounter = new Map();
/**
 * Generates `otel.sdk.exporter.*` metrics.
 * https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics
 */
class ExporterMetrics {
    inflight;
    exported;
    duration;
    standardAttrs;
    responseAttributesFromError;
    helper;
    constructor(options) {
        const { componentType, metricsHelper, meterProvider, url, responseAttributesFromError, } = options;
        this.responseAttributesFromError = responseAttributesFromError;
        const meter = meterProvider
            ? meterProvider.getMeter('@opentelemetry/otlp-exporter', version_1.VERSION)
            : (0, api_1.createNoopMeter)();
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [semconv_1.ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [semconv_1.ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
        };
        if (url) {
            // URLs may exclude scheme for gRPC endpoints, but in this case they always
            // have a port number. Because the URL constructor requires a scheme, we
            // can still handle gRPC endpoints by prepending an arbitrary scheme.
            let urlToParse = url;
            if (!url.includes('://')) {
                urlToParse = `http://${url}`;
            }
            try {
                const parsedUrl = new URL(urlToParse);
                this.standardAttrs[semconv_1.ATTR_SERVER_ADDRESS] = parsedUrl.hostname;
                let port = undefined;
                if (parsedUrl.port) {
                    port = Number(parsedUrl.port);
                }
                else if (parsedUrl.protocol === 'http:') {
                    port = 80;
                }
                else if (parsedUrl.protocol === 'https:') {
                    port = 443;
                }
                if (typeof port === 'number') {
                    this.standardAttrs[semconv_1.ATTR_SERVER_PORT] = port;
                }
            }
            catch {
                // In practice, URLs will be valid or something else will break. Better to let that
                // inform the user than an exception in this internal code and proceed best-effort
                // here.
            }
        }
        this.helper = metricsHelper;
        this.inflight = meter.createUpDownCounter(`otel.sdk.exporter.${this.helper.name}.inflight`, {
            unit: `{${this.helper.name}}`,
            description: `The number of ${this.helper.name}s which were passed to the exporter, but that have not been exported yet (neither successful, nor failed).`,
        });
        this.exported = meter.createCounter(`otel.sdk.exporter.${this.helper.name}.exported`, {
            unit: `{${this.helper.name}}`,
            description: `The number of ${this.helper.name}s for which the export has finished, either successful or failed.`,
        });
        this.duration = meter.createHistogram('otel.sdk.exporter.operation.duration', {
            unit: 's',
            description: 'The duration of exporting a batch of telemetry records.',
            advice: {
                explicitBucketBoundaries: [],
            },
        });
    }
    startExport(request) {
        const numItems = this.helper.countItems(request);
        const startTime = (0, core_1.hrTime)();
        this.inflight.add(numItems, this.standardAttrs);
        return (error) => {
            const endTime = (0, core_1.hrTime)();
            this.inflight.add(-numItems, this.standardAttrs);
            const exportedAttrs = error
                ? {
                    ...this.standardAttrs,
                    [semconv_1.ATTR_ERROR_TYPE]: error instanceof Error ? error.name : 'export_failed',
                }
                : this.standardAttrs;
            this.exported.add(numItems, exportedAttrs);
            const durationAttrs = {
                ...exportedAttrs,
                ...this.responseAttributesFromError(error),
            };
            const duration = (0, core_1.hrTimeToMilliseconds)((0, core_1.hrTimeDuration)(startTime, endTime)) / 1000;
            this.duration.record(duration, durationAttrs);
        };
    }
}
exports.ExporterMetrics = ExporterMetrics;
//# sourceMappingURL=ExporterMetrics.js.map