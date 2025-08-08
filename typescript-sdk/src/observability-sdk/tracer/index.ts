import {
  trace,
} from "@opentelemetry/api";
import { LangWatchTracer } from "./types";
import { getLangWatchTracerFromProvider } from "./implementation";

/**
 * Get a LangWatch tracer from the global OpenTelemetry tracer provider.
 *
 * This is the primary entry point for obtaining a LangWatch tracer instance.
 * It uses the globally configured OpenTelemetry tracer provider and wraps
 * the resulting tracer with LangWatch-specific enhancements.
 *
 * **Prerequisites**: Ensure that LangWatch's observability setup has been
 * initialized before calling this function, otherwise the global tracer
 * provider may not be properly configured.
 *
 * @param name - The name of the tracer, typically your service or library name
 * @param version - Optional version identifier for the tracer
 * @returns A LangWatch tracer with enhanced functionality
 *
 * @example Basic usage
 * ```typescript
 * import { getLangWatchTracer } from '@langwatch/typescript-sdk';
 *
 * const tracer = getLangWatchTracer('my-service', '1.0.0');
 *
 * // Use the tracer to create spans
 * const result = await tracer.withActiveSpan('operation', async (span) => {
 *   span.setAttributes({ userId: '123' });
 *   return await performOperation();
 * });
 * ```
 *
 * @example Multiple tracers for different components
 * ```typescript
 * const apiTracer = getLangWatchTracer('api-server', '2.1.0');
 * const dbTracer = getLangWatchTracer('database-client', '1.5.2');
 *
 * // Each tracer can be used independently
 * await apiTracer.withActiveSpan('handle-request', async (span) => {
 *   await dbTracer.withActiveSpan('query-users', async (dbSpan) => {
 *     // Nested spans with proper parent-child relationships
 *   });
 * });
 * ```
 */
export function getLangWatchTracer(
  name: string,
  version?: string,
): LangWatchTracer {
  return getLangWatchTracerFromProvider(
    trace.getTracerProvider(),
    name,
    version,
  );
}

// Export types and implementation
export * from "./types";
export * from "./implementation";
