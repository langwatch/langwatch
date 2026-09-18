/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createNoopMeter, TraceFlags } from '@opentelemetry/api';
import { internal, ExportResultCode, globalErrorHandler, BindOnceFuture, } from '@opentelemetry/core';
import { SpanProcessorMetrics } from './SpanProcessorMetrics';
import { OTEL_COMPONENT_TYPE_VALUE_SIMPLE_SPAN_PROCESSOR } from '../semconv';
/**
 * An implementation of the {@link SpanProcessor} that converts the {@link Span}
 * to {@link ReadableSpan} and passes it to the configured exporter.
 *
 * Only spans that are sampled are converted.
 *
 * NOTE: This {@link SpanProcessor} exports every ended span individually instead of batching spans together, which causes significant performance overhead with most exporters. For production use, please consider using the {@link BatchSpanProcessor} instead.
 */
export class SimpleSpanProcessor {
    _exporter;
    _metrics;
    _shutdownOnce;
    _pendingExports;
    constructor(options) {
        this._exporter = options.exporter;
        this._shutdownOnce = new BindOnceFuture(this._shutdown, this);
        this._pendingExports = new Set();
        const meter = options.selfObsMeterProvider
            ? options.selfObsMeterProvider.getMeter('@opentelemetry/sdk-trace')
            : createNoopMeter();
        this._metrics = new SpanProcessorMetrics(OTEL_COMPONENT_TYPE_VALUE_SIMPLE_SPAN_PROCESSOR, meter);
    }
    async forceFlush() {
        let pendingExportError;
        let pendingExportRejected = false;
        try {
            await Promise.all(Array.from(this._pendingExports));
        }
        catch (err) {
            pendingExportError = err;
            pendingExportRejected = true;
        }
        if (this._exporter.forceFlush) {
            await this._exporter.forceFlush();
        }
        if (pendingExportRejected) {
            throw pendingExportError;
        }
    }
    onStart(_span, _parentContext) { }
    onEnd(span) {
        if (this._shutdownOnce.isCalled) {
            return;
        }
        if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0) {
            return;
        }
        const pendingExport = this._doExport(span);
        // Enqueue this export to the pending list so it can be flushed by the user.
        this._pendingExports.add(pendingExport);
        void pendingExport.then(() => {
            this._pendingExports.delete(pendingExport);
        }, err => {
            globalErrorHandler(err);
            this._pendingExports.delete(pendingExport);
        });
    }
    async _doExport(span) {
        if (span.resource.asyncAttributesPending) {
            // Ensure resource is fully resolved before exporting.
            await span.resource.waitForAsyncAttributes?.();
        }
        const result = await internal._export(this._exporter, [span]);
        this._metrics.finishSpans(1, result.error);
        if (result.code !== ExportResultCode.SUCCESS) {
            throw (result.error ??
                new Error(`SimpleSpanProcessor: span export failed (status ${result})`));
        }
    }
    shutdown() {
        return this._shutdownOnce.call();
    }
    _shutdown() {
        this._metrics.shutdown();
        return this._exporter.shutdown();
    }
}
//# sourceMappingURL=SimpleSpanProcessor.js.map