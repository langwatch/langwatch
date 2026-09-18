import { TracingProcessor } from './processor';
export type TraceOptions = {
    traceId?: string;
    name?: string;
    groupId?: string;
    metadata?: Record<string, any>;
    started?: boolean;
    tracingApiKey?: string;
};
export declare class Trace {
    #private;
    type: "trace";
    traceId: string;
    name: string;
    groupId: string | null;
    metadata?: Record<string, any>;
    tracingApiKey?: string;
    constructor(options: TraceOptions, processor?: TracingProcessor);
    start(): Promise<void>;
    end(): Promise<void>;
    clone(): Trace;
    /**
     * Serializes the trace for export or persistence.
     * Set `includeTracingApiKey` to true only when you intentionally need to persist the
     * exporter credentials (for example, when handing off a run to another process that
     * cannot access the original environment). Defaults to false to avoid leaking secrets.
     */
    toJSON(options?: {
        includeTracingApiKey?: boolean;
    }): object | null;
}
export declare class NoopTrace extends Trace {
    constructor();
    start(): Promise<void>;
    end(): Promise<void>;
    toJSON(): object | null;
}
