/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createNoopMeter, } from '@opentelemetry/api';
import { hrTime, hrTimeDuration, hrTimeToMilliseconds, } from '@opentelemetry/core';
import { ATTR_ERROR_TYPE, ATTR_OTEL_COMPONENT_NAME, ATTR_OTEL_COMPONENT_TYPE, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT, } from './semconv';
import { VERSION } from './version';
const componentCounter = new Map();
/**
 * Generates `otel.sdk.exporter.*` metrics.
 * https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics
 */
export class ExporterMetrics {
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
            ? meterProvider.getMeter('@opentelemetry/otlp-exporter', VERSION)
            : createNoopMeter();
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
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
                this.standardAttrs[ATTR_SERVER_ADDRESS] = parsedUrl.hostname;
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
                    this.standardAttrs[ATTR_SERVER_PORT] = port;
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
        const startTime = hrTime();
        this.inflight.add(numItems, this.standardAttrs);
        return (error) => {
            const endTime = hrTime();
            this.inflight.add(-numItems, this.standardAttrs);
            const exportedAttrs = error
                ? {
                    ...this.standardAttrs,
                    [ATTR_ERROR_TYPE]: error instanceof Error ? error.name : 'export_failed',
                }
                : this.standardAttrs;
            this.exported.add(numItems, exportedAttrs);
            const durationAttrs = {
                ...exportedAttrs,
                ...this.responseAttributesFromError(error),
            };
            const duration = hrTimeToMilliseconds(hrTimeDuration(startTime, endTime)) / 1000;
            this.duration.record(duration, durationAttrs);
        };
    }
}
//# sourceMappingURL=ExporterMetrics.js.map