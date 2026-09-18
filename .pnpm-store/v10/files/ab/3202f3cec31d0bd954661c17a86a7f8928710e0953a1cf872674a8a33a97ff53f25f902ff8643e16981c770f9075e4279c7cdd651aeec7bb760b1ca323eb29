"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleLogRecordProcessor = void 0;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const semconv_1 = require("../semconv");
const LogRecordProcessorMetrics_1 = require("./LogRecordProcessorMetrics");
/**
 * An implementation of the {@link LogRecordProcessor} interface that exports
 * each {@link LogRecord} as it is emitted.
 *
 * NOTE: This {@link LogRecordProcessor} exports every {@link LogRecord}
 * individually instead of batching them together, which can cause significant
 * performance overhead with most exporters. For production use, please consider
 * using the {@link BatchLogRecordProcessor} instead.
 */
class SimpleLogRecordProcessor {
    _exporter;
    _metrics;
    _shutdownOnce;
    _unresolvedExports;
    constructor(options) {
        this._exporter = options.exporter;
        this._shutdownOnce = new core_1.BindOnceFuture(this._shutdown, this);
        this._unresolvedExports = new Set();
        const meter = options?.selfObsMeterProvider
            ? options.selfObsMeterProvider.getMeter('@opentelemetry/sdk-logs')
            : (0, api_1.createNoopMeter)();
        this._metrics = new LogRecordProcessorMetrics_1.LogRecordProcessorMetrics(semconv_1.OTEL_COMPONENT_TYPE_VALUE_SIMPLE_LOG_PROCESSOR, meter);
    }
    onEmit(logRecord, _context) {
        if (this._shutdownOnce.isCalled) {
            return;
        }
        const doExport = () => core_1.internal
            ._export(this._exporter, [logRecord])
            .then((result) => {
            this._metrics.finishLogs(1, result.error);
            if (result.code !== core_1.ExportResultCode.SUCCESS) {
                (0, core_1.globalErrorHandler)(result.error ??
                    new Error(`SimpleLogRecordProcessor: log record export failed (status ${result})`));
            }
        })
            .catch(core_1.globalErrorHandler);
        // Avoid scheduling a promise to make the behavior more predictable and easier to test
        if (logRecord.resource.asyncAttributesPending) {
            const exportPromise = logRecord.resource
                .waitForAsyncAttributes?.()
                .then(() => {
                // Using TS Non-null assertion operator because exportPromise could not be null in here
                // if waitForAsyncAttributes is not present this code will never be reached
                this._unresolvedExports.delete(exportPromise);
                return doExport();
            }, core_1.globalErrorHandler);
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
exports.SimpleLogRecordProcessor = SimpleLogRecordProcessor;
//# sourceMappingURL=SimpleLogRecordProcessor.js.map