/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPExporterError } from './types';
import { createLoggingPartialSuccessResponseHandler } from './logging-response-handler';
import { diag } from '@opentelemetry/api';
class OTLPExportDelegate {
    _metrics;
    _diagLogger;
    _transport;
    _serializer;
    _responseHandler;
    _promiseQueue;
    _timeout;
    constructor(transport, serializer, responseHandler, promiseQueue, metrics, timeout) {
        this._transport = transport;
        this._serializer = serializer;
        this._responseHandler = responseHandler;
        this._promiseQueue = promiseQueue;
        this._timeout = timeout;
        this._diagLogger = diag.createComponentLogger({
            namespace: 'OTLPExportDelegate',
        });
        this._metrics = metrics;
    }
    export(internalRepresentation, resultCallback) {
        this._diagLogger.debug('items to be sent', internalRepresentation);
        // don't do any work if too many exports are in progress.
        if (this._promiseQueue.hasReachedLimit()) {
            resultCallback({
                code: ExportResultCode.FAILED,
                error: new Error('Concurrent export limit reached'),
            });
            return;
        }
        const serializedRequest = this._serializer.serializeRequest(internalRepresentation);
        if (serializedRequest == null) {
            resultCallback({
                code: ExportResultCode.FAILED,
                error: new Error('Nothing to send'),
            });
            return;
        }
        const finishExport = this._metrics.startExport(internalRepresentation);
        this._promiseQueue.pushPromise(this._transport.send(serializedRequest, this._timeout).then(response => {
            if (response.status === 'success') {
                finishExport(undefined);
                if (response.data != null) {
                    try {
                        this._responseHandler.handleResponse(this._serializer.deserializeResponse(response.data));
                    }
                    catch (e) {
                        this._diagLogger.warn('Export succeeded but could not deserialize response - is the response specification compliant?', e, response.data);
                    }
                }
                // No matter the response, we can consider the export still successful.
                resultCallback({
                    code: ExportResultCode.SUCCESS,
                });
                return;
            }
            else if (response.status === 'failure' && response.error) {
                finishExport(response.error);
                resultCallback({
                    code: ExportResultCode.FAILED,
                    error: response.error,
                });
                return;
            }
            else if (response.status === 'retryable') {
                finishExport('export_max_retries');
                resultCallback({
                    code: ExportResultCode.FAILED,
                    error: response.error ??
                        new OTLPExporterError('Export failed with retryable status'),
                });
            }
            else {
                finishExport('export_failed');
                resultCallback({
                    code: ExportResultCode.FAILED,
                    error: new OTLPExporterError('Export failed with unknown error'),
                });
            }
        }, reason => {
            finishExport(reason);
            resultCallback({
                code: ExportResultCode.FAILED,
                error: reason,
            });
        }));
    }
    forceFlush() {
        return this._promiseQueue.awaitAll();
    }
    setMetrics(metrics) {
        this._metrics = metrics;
    }
    async shutdown() {
        this._diagLogger.debug('shutdown started');
        await this.forceFlush();
        this._transport.shutdown();
    }
}
/**
 * Creates a generic delegate for OTLP exports which only contains parts of the OTLP export that are shared across all
 * signals.
 */
export function createOtlpExportDelegate(components, settings) {
    return new OTLPExportDelegate(components.transport, components.serializer, createLoggingPartialSuccessResponseHandler(), components.promiseHandler, components.metrics, settings.timeout);
}
//# sourceMappingURL=otlp-export-delegate.js.map