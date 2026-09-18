import type { TracerProvider as ApiTracerProvider, Tracer as ApiTracer } from '@opentelemetry/api';
import type { TracerProviderOptions } from './types';
import type { InspectFn, InspectStylizeOptions } from './inspect';
import { inspectCustom } from './inspect';
/**
 * This class represents a basic tracer provider which platform libraries can extend
 */
export declare class TracerProvider implements ApiTracerProvider {
    private readonly _resource;
    private readonly _activeSpanProcessor;
    private readonly _forceFlushTimeoutMillis;
    private readonly _tracerOptions;
    private readonly _tracers;
    constructor(options?: TracerProviderOptions);
    getTracer(name: string, version?: string, options?: {
        schemaUrl?: string;
    }): ApiTracer;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
    [inspectCustom](depth: number, options: InspectStylizeOptions | undefined, inspect: InspectFn | undefined): unknown;
}
//# sourceMappingURL=TracerProvider.d.ts.map