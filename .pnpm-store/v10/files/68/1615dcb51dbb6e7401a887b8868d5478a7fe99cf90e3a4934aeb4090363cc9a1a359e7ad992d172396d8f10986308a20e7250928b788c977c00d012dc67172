"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeriodicExportingMetricReader = void 0;
const api = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const MetricReader_1 = require("./MetricReader");
const utils_1 = require("../utils");
const MetricData_1 = require("./MetricData");
const MetricDataSplitter_1 = require("./MetricDataSplitter");
const semconv_1 = require("../semconv");
/**
 * {@link MetricReader} which collects metrics based on a user-configurable time interval, and passes the metrics to
 * the configured {@link PushMetricExporter}
 */
class PeriodicExportingMetricReader extends MetricReader_1.MetricReader {
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
            otelComponentType: semconv_1.OTEL_COMPONENT_TYPE_VALUE_PERIODIC_METRIC_READER,
            metricProducers,
            cardinalitySelector: (instrumentType) => {
                const limits = {
                    default: 2000,
                    ...cardinalityLimits,
                };
                switch (instrumentType) {
                    case MetricData_1.InstrumentType.COUNTER:
                        return limits.counter ?? limits.default;
                    case MetricData_1.InstrumentType.GAUGE:
                        return limits.gauge ?? limits.default;
                    case MetricData_1.InstrumentType.HISTOGRAM:
                        return limits.histogram ?? limits.default;
                    case MetricData_1.InstrumentType.OBSERVABLE_COUNTER:
                        return limits.observableCounter ?? limits.default;
                    case MetricData_1.InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
                        return limits.observableUpDownCounter ?? limits.default;
                    case MetricData_1.InstrumentType.OBSERVABLE_GAUGE:
                        return limits.observableGauge ?? limits.default;
                    case MetricData_1.InstrumentType.UP_DOWN_COUNTER:
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
            (0, core_1.globalErrorHandler)(err);
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
                    (0, core_1.globalErrorHandler)(e);
                }
            }
            if (resourceMetrics.scopeMetrics.length === 0) {
                return;
            }
            const batches = this._maxExportBatchSize
                ? (0, MetricDataSplitter_1.splitMetricData)(resourceMetrics, this._maxExportBatchSize)
                : [resourceMetrics];
            let anyErr = null;
            for (const batch of batches) {
                try {
                    const result = await (0, utils_1.callWithTimeout)(core_1.internal._export(this._exporter, batch), this._exportTimeout);
                    if (result.code !== core_1.ExportResultCode.SUCCESS) {
                        const err = new Error(`PeriodicExportingMetricReader: metrics export failed (error ${result.error})`);
                        anyErr = err;
                    }
                }
                catch (e) {
                    if (e instanceof utils_1.TimeoutError) {
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
exports.PeriodicExportingMetricReader = PeriodicExportingMetricReader;
//# sourceMappingURL=PeriodicExportingMetricReader.js.map