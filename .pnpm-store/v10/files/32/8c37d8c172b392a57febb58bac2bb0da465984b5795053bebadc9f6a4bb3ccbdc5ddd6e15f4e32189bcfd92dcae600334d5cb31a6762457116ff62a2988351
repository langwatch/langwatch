/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { ATTR_ERROR_TYPE, ATTR_OTEL_COMPONENT_NAME, ATTR_OTEL_COMPONENT_TYPE, METRIC_OTEL_SDK_PROCESSOR_LOG_PROCESSED, METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY, METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE, } from '../semconv';
const componentCounter = new Map();
export class LogRecordProcessorMetrics {
    processedLogs;
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
        this.processedLogs = meter.createCounter(METRIC_OTEL_SDK_PROCESSOR_LOG_PROCESSED, {
            unit: '{log_record}',
            description: 'The number of log records for which the processing has finished, either successful or failed.',
        });
        if (queueConfig) {
            const { capacity, getQueueSize } = queueConfig;
            const queueCapacity = meter.createUpDownCounter(METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY, {
                unit: '{log_record}',
                description: 'The maximum number of log records the queue of a given instance of an SDK log processor can hold.',
            });
            queueCapacity.add(capacity, this.standardAttrs);
            this.queueSize = meter.createObservableUpDownCounter(METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE, {
                unit: '{log_record}',
                description: 'The number of log records in the queue of a given instance of an SDK log processor.',
            });
            this.queueSizeCallback = result => result.observe(getQueueSize(), this.standardAttrs);
            this.queueSize.addCallback(this.queueSizeCallback);
        }
    }
    dropLogs(count) {
        this.processedLogs.add(count, this.droppedAttrs);
    }
    finishLogs(count, error) {
        if (!error) {
            this.processedLogs.add(count, this.standardAttrs);
            return;
        }
        const attrs = {
            ...this.standardAttrs,
            [ATTR_ERROR_TYPE]: error.name,
        };
        this.processedLogs.add(count, attrs);
    }
    shutdown() {
        if (this.queueSize && this.queueSizeCallback) {
            this.queueSize.removeCallback(this.queueSizeCallback);
        }
    }
}
//# sourceMappingURL=LogRecordProcessorMetrics.js.map