"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricReaderMetrics = void 0;
const semconv_1 = require("../semconv");
const componentCounter = new Map();
/**
 * Generates `otel.sdk.metric_reader.*` self-observability metrics.
 * https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics/#metric-otelsdkmetric_readercollectionduration
 */
class MetricReaderMetrics {
    collectionDuration;
    standardAttrs;
    constructor(componentType, meter) {
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [semconv_1.ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [semconv_1.ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
        };
        this.collectionDuration = meter.createHistogram(semconv_1.METRIC_OTEL_SDK_METRIC_READER_COLLECTION_DURATION, {
            unit: 's',
            description: 'The duration of the collect operation of the metric reader.',
            advice: {
                explicitBucketBoundaries: [],
            },
        });
    }
    recordCollection(durationSecs, error) {
        const attrs = error
            ? { ...this.standardAttrs, [semconv_1.ATTR_ERROR_TYPE]: error }
            : this.standardAttrs;
        this.collectionDuration.record(durationSecs, attrs);
    }
}
exports.MetricReaderMetrics = MetricReaderMetrics;
//# sourceMappingURL=MetricReaderMetrics.js.map