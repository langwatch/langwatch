/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { ATTR_ERROR_TYPE, ATTR_OTEL_COMPONENT_NAME, ATTR_OTEL_COMPONENT_TYPE, METRIC_OTEL_SDK_METRIC_READER_COLLECTION_DURATION, } from '../semconv';
const componentCounter = new Map();
/**
 * Generates `otel.sdk.metric_reader.*` self-observability metrics.
 * https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics/#metric-otelsdkmetric_readercollectionduration
 */
export class MetricReaderMetrics {
    collectionDuration;
    standardAttrs;
    constructor(componentType, meter) {
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
        };
        this.collectionDuration = meter.createHistogram(METRIC_OTEL_SDK_METRIC_READER_COLLECTION_DURATION, {
            unit: 's',
            description: 'The duration of the collect operation of the metric reader.',
            advice: {
                explicitBucketBoundaries: [],
            },
        });
    }
    recordCollection(durationSecs, error) {
        const attrs = error
            ? { ...this.standardAttrs, [ATTR_ERROR_TYPE]: error }
            : this.standardAttrs;
        this.collectionDuration.record(durationSecs, attrs);
    }
}
//# sourceMappingURL=MetricReaderMetrics.js.map