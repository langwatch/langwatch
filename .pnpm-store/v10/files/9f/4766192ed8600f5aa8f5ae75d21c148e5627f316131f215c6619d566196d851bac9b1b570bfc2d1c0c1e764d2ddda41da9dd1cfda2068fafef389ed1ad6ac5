import type { ExportResult } from '@opentelemetry/core';
import type { IOtlpExportDelegate } from './otlp-export-delegate';
import { type ExporterMetrics } from './ExporterMetrics';
export declare class OTLPExporterBase<Internal> {
    private _delegate;
    constructor(delegate: IOtlpExportDelegate<Internal>);
    /**
     * Export items.
     * @param items
     * @param resultCallback
     */
    export(items: Internal, resultCallback: (result: ExportResult) => void): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
    protected setMetrics(metrics: ExporterMetrics<Internal>): void;
}
//# sourceMappingURL=OTLPExporterBase.d.ts.map