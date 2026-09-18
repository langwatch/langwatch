/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createNoopMeter } from '@opentelemetry/api';
import { BindOnceFuture, ExportResultCode, globalErrorHandler, internal, } from '@opentelemetry/core';
import { OTEL_COMPONENT_TYPE_VALUE_SIMPLE_LOG_PROCESSOR } from '../semconv';
import { LogRecordProcessorMetrics } from './LogRecordProcessorMetrics';
/**
 * An implementation of the {@link LogRecordProcessor} interface that exports
 * each {@link LogRecord} as it is emitted.
 *
 * NOTE: This {@link LogRecordProcessor} exports every {@link LogRecord}
 * individually instead of batching them together, which can cause significant
 * performance overhead with most exporters. For production use, please consider
 * using the {@link BatchLogRecordProcessor} instead.
 */
export class SimpleLogRecordProcessor {
    _exporter;
    _metrics;
    _shutdownOnce;
    _unresolvedExports;
    constructor(options) {
        this._exporter = options.exporter;
        this._shutdownOnce = new BindOnceFuture(this._shutdown, this);
        this._unresolvedExports = new Set();
        const meter = options?.selfObsMeterProvider
            ? options.selfObsMeterProvider.getMeter('@opentelemetry/sdk-logs')
            : createNoopMeter();
        this._metrics = new LogRecordProcessorMetrics(OTEL_COMPONENT_TYPE_VALUE_SIMPLE_LOG_PROCESSOR, meter);
    }
    onEmit(logRecord, _context) {
        if (this._shutdownOnce.isCalled) {
            return;
        }
        const doExport = () => internal
            ._export(this._exporter, [logRecord])
            .then((result) => {
            this._metrics.finishLogs(1, result.error);
            if (result.code !== ExportResultCode.SUCCESS) {
                globalErrorHandler(result.error ??
                    new Error(`SimpleLogRecordProcessor: log record export failed (status ${result})`));
            }
        })
            .catch(globalErrorHandler);
        // Avoid scheduling a promise to make the behavior more predictable and easier to test
        if (logRecord.resource.asyncAttributesPending) {
            const exportPromise = logRecord.resource
                .waitForAsyncAttributes?.()
                .then(() => {
                // Using TS Non-null assertion operator because exportPromise could not be null in here
                // if waitForAsyncAttributes is not present this code will never be reached
                this._unresolvedExports.delete(exportPromise);
                return doExport();
            }, globalErrorHandler);
            // store the unresolved exports
            if (exportPromise != null) {
                this._unresolvedExports.add(exportPromise);
            }
        }
        else {
            void doExport();
        }
    }
    async forceFlush() {
        // await unresolved resources before resolving
        await Promise.all(Array.from(this._unresolvedExports));
    }
    shutdown() {
        return this._shutdownOnce.call();
    }
    _shutdown() {
        this._metrics.shutdown();
        return this._exporter.shutdown();
    }
}
//# sourceMappingURL=SimpleLogRecordProcessor.js.map