/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import * as api from '@opentelemetry/api';
import { internal, ExportResultCode, globalErrorHandler, } from '@opentelemetry/core';
import { MetricReader } from './MetricReader';
import { callWithTimeout, TimeoutError } from '../utils';
import { InstrumentType } from './MetricData';
import { splitMetricData } from './MetricDataSplitter';
import { OTEL_COMPONENT_TYPE_VALUE_PERIODIC_METRIC_READER } from '../semconv';
/**
 * {@link MetricReader} which collects metrics based on a user-configurable time interval, and passes the metrics to
 * the configured {@link PushMetricExporter}
 */
export class PeriodicExportingMetricReader extends MetricReader {
    _interval;
    _exporter;
    _exportInterval;
    _exportTimeout;
    _maxExportBatchSize;
    _ongoingExportPromise = null;
    constructor(options) {
        const { exporter, exportIntervalMillis = 60000, metricProducers, cardinalityLimits, maxExportBatchSize, } = options;
        let { exportTimeoutMillis = 30000 } = options;
        super({
            aggregationSelector: exporter.selectAggregation?.bind(exporter),
            aggregationTemporalitySelector: exporter.selectAggregationTemporality?.bind(exporter),
            otelComponentType: OTEL_COMPONENT_TYPE_VALUE_PERIODIC_METRIC_READER,
            metricProducers,
            cardinalitySelector: (instrumentType) => {
                const limits = {
                    default: 2000,
                    ...cardinalityLimits,
                };
                switch (instrumentType) {
                    case InstrumentType.COUNTER:
                        return limits.counter ?? limits.default;
                    case InstrumentType.GAUGE:
                        return limits.gauge ?? limits.default;
                    case InstrumentType.HISTOGRAM:
                        return limits.histogram ?? limits.default;
                    case InstrumentType.OBSERVABLE_COUNTER:
                        return limits.observableCounter ?? limits.default;
                    case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
                        return limits.observableUpDownCounter ?? limits.default;
                    case InstrumentType.OBSERVABLE_GAUGE:
                        return limits.observableGauge ?? limits.default;
                    case InstrumentType.UP_DOWN_COUNTER:
                        return limits.upDownCounter ?? limits.default;
                    default:
                        return limits.default;
                }
            },
        });
        if (exportIntervalMillis <= 0) {
            throw Error('exportIntervalMillis must be greater than 0');
        }
        if (exportTimeoutMillis <= 0) {
            throw Error('exportTimeoutMillis must be greater than 0');
        }
        if (maxExportBatchSize !== undefined &&
            (!Number.isInteger(maxExportBatchSize) || maxExportBatchSize <= 0)) {
            throw Error('maxExportBatchSize must be a positive integer');
        }
        if (exportIntervalMillis < exportTimeoutMillis) {
            if ('exportIntervalMillis' in options &&
                'exportTimeoutMillis' in options) {
                // An invalid combination of values was explicitly provided.
                throw Error('exportIntervalMillis must be greater than or equal to exportTimeoutMillis');
            }
            else {
                // An invalid combination of value was implicitly provided.
                api.diag.info(`Timeout of ${exportTimeoutMillis} exceeds the interval of ${exportIntervalMillis}. Clamping timeout to interval duration.`);
                exportTimeoutMillis = exportIntervalMillis;
            }
        }
        this._exportInterval = exportIntervalMillis;
        this._exportTimeout = exportTimeoutMillis;
        this._exporter = exporter;
        this._maxExportBatchSize = maxExportBatchSize;
    }
    async _runOnce() {
        try {
            await this._doRun();
        }
        catch (err) {
            globalErrorHandler(err);
        }
    }
    async _doRun() {
        if (this._ongoingExportPromise) {
            api.diag.debug('PeriodicExportingMetricReader: export already in progress, skipping');
            return;
        }
        const currentRun = async () => {
            const { resourceMetrics, errors } = await this.collect({
                timeoutMillis: this._exportTimeout,
            });
            if (errors.length > 0) {
                api.diag.error('PeriodicExportingMetricReader: metrics collection errors', ...errors);
            }
            if (resourceMetrics.resource.asyncAttributesPending) {
                try {
                    await resourceMetrics.resource.waitForAsyncAttributes?.();
                }
                catch (e) {
                    api.diag.debug('Error while resolving async portion of resource: ', e);
                    globalErrorHandler(e);
                }
            }
            if (resourceMetrics.scopeMetrics.length === 0) {
                return;
            }
            const batches = this._maxExportBatchSize
                ? splitMetricData(resourceMetrics, this._maxExportBatchSize)
                : [resourceMetrics];
            let anyErr = null;
            for (const batch of batches) {
                try {
                    const result = await callWithTimeout(internal._export(this._exporter, batch), this._exportTimeout);
                    if (result.code !== ExportResultCode.SUCCESS) {
                        const err = new Error(`PeriodicExportingMetricReader: metrics export failed (error ${result.error})`);
                        anyErr = err;
                    }
                }
                catch (e) {
                    if (e instanceof TimeoutError) {
                        api.diag.error(`PeriodicExportingMetricReader: metrics export timed out after ${this._exportTimeout}ms`);
                        break;
                    }
                    else {
                        api.diag.error('PeriodicExportingMetricReader: metrics export threw error', e);
                        anyErr = e instanceof Error ? e : new Error(String(e));
                    }
                }
            }
            if (anyErr) {
                throw anyErr;
            }
        };
        this._ongoingExportPromise = currentRun();
        try {
            await this._ongoingExportPromise;
        }
        finally {
            this._ongoingExportPromise = null;
        }
    }
    onInitialized() {
        // start running the interval as soon as this reader is initialized and keep handle for shutdown.
        this._interval = setInterval(() => {
            // this._runOnce never rejects. Using void operator to suppress @typescript-eslint/no-floating-promises.
            void this._runOnce();
        }, this._exportInterval);
        // depending on runtime, this may be a 'number' or NodeJS.Timeout
        if (typeof this._interval !== 'number') {
            this._interval.unref();
        }
    }
    async onForceFlush() {
        // Wait for any in-progress export to finish first so that we never run
        // collect + export concurrently with it.
        await this._awaitOngoingExport();
        // forceFlush SHOULD collect and export the latest metrics. If a concurrent
        // caller already started a fresh export while we were waiting above, await
        // that one instead of starting yet another collect + export cycle;
        // otherwise run our own.
        if (this._ongoingExportPromise) {
            await this._awaitOngoingExport();
        }
        else {
            await this._runOnce();
        }
        await this._exporter.forceFlush();
    }
    /**
     * Helper function to wait for an ongoing export to complete.
     * Errors are swallowed and handled by the original _runOnce().
     */
    async _awaitOngoingExport() {
        if (this._ongoingExportPromise) {
            api.diag.debug('PeriodicExportingMetricReader: export already in progress, awaiting ongoing export');
            try {
                await this._ongoingExportPromise;
            }
            catch {
                // Error is handled by the _runOnce() that initiated the export.
            }
        }
    }
    async onShutdown() {
        if (this._interval) {
            clearInterval(this._interval);
        }
        await this.onForceFlush();
        await this._exporter.shutdown();
    }
}
//# sourceMappingURL=PeriodicExportingMetricReader.js.map