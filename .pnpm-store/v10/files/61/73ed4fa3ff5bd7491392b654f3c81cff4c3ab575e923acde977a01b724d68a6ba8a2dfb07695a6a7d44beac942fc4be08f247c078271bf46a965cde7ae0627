/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { ATTR_ERROR_TYPE } from '@opentelemetry/semantic-conventions';
import { ATTR_OTEL_COMPONENT_NAME, ATTR_OTEL_COMPONENT_TYPE, METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED, METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY, METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE, } from '../semconv';
const componentCounter = new Map();
export class SpanProcessorMetrics {
    processedSpans;
    queueSize;
    queueSizeCallback;
    standardAttrs;
    droppedAttrs;
    constructor(componentType, meter, queueConfig) {
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
        };
        this.droppedAttrs = {
            ...this.standardAttrs,
            [ATTR_ERROR_TYPE]: 'queue_full',
        };
        this.processedSpans = meter.createCounter(METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED, {
            unit: '{span}',
            description: 'The number of spans for which the processing has finished, either successful or failed.',
        });
        if (queueConfig) {
            const { capacity, getQueueSize } = queueConfig;
            const queueCapacity = meter.createUpDownCounter(METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY, {
                unit: '{span}',
                description: 'The maximum number of spans the queue of a given instance of an SDK span processor can hold.',
            });
            queueCapacity.add(capacity, this.standardAttrs);
            this.queueSize = meter.createObservableUpDownCounter(METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE, {
                unit: '{span}',
                description: 'The number of spans in the queue of a given instance of an SDK span processor.',
            });
            this.queueSizeCallback = result => result.observe(getQueueSize(), this.standardAttrs);
            this.queueSize.addCallback(this.queueSizeCallback);
        }
    }
    dropSpans(count) {
        this.processedSpans.add(count, this.droppedAttrs);
    }
    finishSpans(count, error) {
        if (!error) {
            this.processedSpans.add(count, this.standardAttrs);
            return;
        }
        const attrs = {
            ...this.standardAttrs,
            [ATTR_ERROR_TYPE]: error.name,
        };
        this.processedSpans.add(count, attrs);
    }
    shutdown() {
        if (this.queueSize && this.queueSizeCallback) {
            this.queueSize.removeCallback(this.queueSizeCallback);
        }
    }
}
//# sourceMappingURL=SpanProcessorMetrics.js.map