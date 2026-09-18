import type { InstrumentationScope } from '@opentelemetry/core';
import type { Context } from '@opentelemetry/api';
import type { LogRecordProcessor } from './LogRecordProcessor';
import type { SdkLogRecord } from './export/SdkLogRecord';
import type { SeverityNumber } from '@opentelemetry/api-logs';
import type { ForceFlushOptions } from './types';
/**
 * Implementation of the {@link LogRecordProcessor} that simply forwards all
 * received events to a list of {@link LogRecordProcessor}s.
 */
export declare class MultiLogRecordProcessor implements LogRecordProcessor {
    readonly processors: LogRecordProcessor[];
    constructor(processors: LogRecordProcessor[]);
    forceFlush(options?: ForceFlushOptions): Promise<void>;
    onEmit(logRecord: SdkLogRecord, context?: Context): void;
    shutdown(): Promise<void>;
    enabled(options: {
        context: Context;
        instrumentationScope: InstrumentationScope;
        severityNumber?: SeverityNumber;
        eventName?: string;
    }): boolean;
}
//# sourceMappingURL=MultiLogRecordProcessor.d.ts.map