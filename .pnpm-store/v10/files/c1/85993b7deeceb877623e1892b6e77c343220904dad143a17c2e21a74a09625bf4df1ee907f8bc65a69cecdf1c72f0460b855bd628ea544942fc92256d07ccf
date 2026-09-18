import { MetricReader } from './MetricReader';
import type { PushMetricExporter } from './MetricExporter';
import type { MetricProducer } from './MetricProducer';
export type PeriodicExportingMetricReaderOptions = {
    /**
     * The backing exporter for the metric reader.
     */
    exporter: PushMetricExporter;
    /**
     * An internal milliseconds for the metric reader to initiate metric
     * collection.
     */
    exportIntervalMillis?: number;
    /**
     * Milliseconds for the async observable callback to timeout.
     */
    exportTimeoutMillis?: number;
    /**
     * **Note, this option is experimental**. Additional MetricProducers to use as a source of
     * aggregated metric data in addition to the SDK's metric data. The resource returned by
     * these MetricProducers is ignored; the SDK's resource will be used instead.
     * @experimental
     */
    metricProducers?: MetricProducer[];
    /**
     * Cardinality limits for the metric reader, applied per instrument. If not configured, defaults to 2000 time series per instrument. These are wrapped in a cardinalitySelector function that returns limits based on the instrument type, so they can be configured differently per type if desired.
     *
     */
    cardinalityLimits?: {
        counter?: number;
        gauge?: number;
        histogram?: number;
        upDownCounter?: number;
        observableCounter?: number;
        observableGauge?: number;
        observableUpDownCounter?: number;
        default?: number;
    };
    /**
     * The maximum batch size for exports. If configured, the reader will split
     * batches larger than this size into smaller batches.
     * @experimental
     */
    maxExportBatchSize?: number;
};
/**
 * {@link MetricReader} which collects metrics based on a user-configurable time interval, and passes the metrics to
 * the configured {@link PushMetricExporter}
 */
export declare class PeriodicExportingMetricReader extends MetricReader {
    private _interval?;
    private _exporter;
    private readonly _exportInterval;
    private readonly _exportTimeout;
    private readonly _maxExportBatchSize?;
    private _ongoingExportPromise;
    constructor(options: PeriodicExportingMetricReaderOptions);
    private _runOnce;
    private _doRun;
    protected onInitialized(): void;
    protected onForceFlush(): Promise<void>;
    /**
     * Helper function to wait for an ongoing export to complete.
     * Errors are swallowed and handled by the original _runOnce().
     */
    private _awaitOngoingExport;
    protected onShutdown(): Promise<void>;
}
//# sourceMappingURL=PeriodicExportingMetricReader.d.ts.map