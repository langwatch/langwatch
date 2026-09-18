import type { Meter } from '@opentelemetry/api';
interface QueueConfig {
    capacity: number;
    getQueueSize: () => number;
}
export declare class SpanProcessorMetrics {
    private readonly processedSpans;
    private readonly queueSize;
    private readonly queueSizeCallback;
    private readonly standardAttrs;
    private readonly droppedAttrs;
    constructor(componentType: string, meter: Meter, queueConfig?: QueueConfig);
    dropSpans(count: number): void;
    finishSpans(count: number, error: Error | undefined): void;
    shutdown(): void;
}
export {};
//# sourceMappingURL=SpanProcessorMetrics.d.ts.map