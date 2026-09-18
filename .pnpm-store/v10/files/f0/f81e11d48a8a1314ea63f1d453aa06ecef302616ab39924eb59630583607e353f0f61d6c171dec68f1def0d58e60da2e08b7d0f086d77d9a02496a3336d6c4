import type { Meter } from '@opentelemetry/api';
interface QueueConfig {
    capacity: number;
    getQueueSize: () => number;
}
export declare class LogRecordProcessorMetrics {
    private readonly processedLogs;
    private readonly queueSize;
    private readonly queueSizeCallback;
    private readonly standardAttrs;
    private readonly droppedAttrs;
    constructor(componentType: string, meter: Meter, queueConfig?: QueueConfig);
    dropLogs(count: number): void;
    finishLogs(count: number, error: Error | undefined): void;
    shutdown(): void;
}
export {};
//# sourceMappingURL=LogRecordProcessorMetrics.d.ts.map