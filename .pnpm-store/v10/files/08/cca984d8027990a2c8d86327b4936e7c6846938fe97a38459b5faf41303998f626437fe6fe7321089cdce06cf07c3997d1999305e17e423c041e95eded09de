"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpanProcessorMetrics = void 0;
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semconv_1 = require("../semconv");
const componentCounter = new Map();
class SpanProcessorMetrics {
    processedSpans;
    queueSize;
    queueSizeCallback;
    standardAttrs;
    droppedAttrs;
    constructor(componentType, meter, queueConfig) {
        const counter = componentCounter.get(componentType) ?? 0;
        componentCounter.set(componentType, counter + 1);
        this.standardAttrs = {
            [semconv_1.ATTR_OTEL_COMPONENT_TYPE]: componentType,
            [semconv_1.ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`,
        };
        this.droppedAttrs = {
            ...this.standardAttrs,
            [semantic_conventions_1.ATTR_ERROR_TYPE]: 'queue_full',
        };
        this.processedSpans = meter.createCounter(semconv_1.METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED, {
            unit: '{span}',
            description: 'The number of spans for which the processing has finished, either successful or failed.',
        });
        if (queueConfig) {
            const { capacity, getQueueSize } = queueConfig;
            const queueCapacity = meter.createUpDownCounter(semconv_1.METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY, {
                unit: '{span}',
                description: 'The maximum number of spans the queue of a given instance of an SDK span processor can hold.',
            });
            queueCapacity.add(capacity, this.standardAttrs);
            this.queueSize = meter.createObservableUpDownCounter(semconv_1.METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE, {
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
            [semantic_conventions_1.ATTR_ERROR_TYPE]: error.name,
        };
        this.processedSpans.add(count, attrs);
    }
    shutdown() {
        if (this.queueSize && this.queueSizeCallback) {
            this.queueSize.removeCallback(this.queueSizeCallback);
        }
    }
}
exports.SpanProcessorMetrics = SpanProcessorMetrics;
//# sourceMappingURL=SpanProcessorMetrics.js.map