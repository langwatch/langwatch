import {
  type Span,
  type SpanOptions,
  type Context,
  SpanStatusCode,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";
import { createLangWatchSpan } from "../span";
import { type LangWatchTracer } from "./types";

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


/**
 * Get a LangWatch tracer from a specific OpenTelemetry tracer provider.
 *
 * This function provides more control over which tracer provider is used,
 * allowing you to work with custom or multiple tracer provider instances.
 * This is useful in advanced scenarios where you need to:
 * - Use different tracer providers for different parts of your application
 * - Work with custom tracer provider configurations
 * - Test with mock tracer providers
 *
 * @param tracerProvider - The OpenTelemetry tracer provider to use
 * @param name - The name of the tracer, typically your service or library name
 * @param version - Optional version identifier for the tracer
 * @returns A LangWatch tracer with enhanced functionality
 *
 * @example Custom tracer provider
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-node';
 * import { getLangWatchTracerFromProvider } from '@langwatch/typescript-sdk';
 *
 * // Create a custom tracer provider with specific configuration
 * const customProvider = new NodeTracerProvider({
 *   resource: Resource.default().merge(
 *     new Resource({
 *       [SemanticResourceAttributes.SERVICE_NAME]: 'custom-service',
 *     })
 *   )
 * });
 *
 * const tracer = getLangWatchTracerFromProvider(
 *   customProvider,
 *   'custom-tracer',
 *   '1.0.0'
 * );
 * ```
 *
 * @example Testing with mock provider
 * ```typescript
 * import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
 *
 * const mockExporter = new InMemorySpanExporter();
 * const testProvider = new NodeTracerProvider();
 * testProvider.addSpanProcessor(new SimpleSpanProcessor(mockExporter));
 *
 * const testTracer = getLangWatchTracerFromProvider(
 *   testProvider,
 *   'test-tracer'
 * );
 *
 * // Use testTracer in tests and verify spans via mockExporter
 * ```
 */
export function getLangWatchTracerFromProvider(
  tracerProvider: TracerProvider,
  name: string,
  version?: string,
): LangWatchTracer {
  const tracer = tracerProvider.getTracer(name, version);

  /**
   * ⚠️ Do not remove, or worse, move this declaration.
   * It's required so the proxy handler can reference the proxyInstance
   * without running afoul of JavaScript's temporal dead zone.
   */
  let proxyInstance: LangWatchTracer;

  const handler: ProxyHandler<LangWatchTracer> = {
    get(target, prop) {
      switch (prop) {
        case "startActiveSpan":
          return (...args: any[]) => {
            const spanArgs = normalizeSpanArgs(args);

            const wrappedFn = (span: Span, ...cbArgs: any[]) =>
              spanArgs.fn(createLangWatchSpan(span), ...cbArgs);

            if (spanArgs.context !== void 0)
              return target.startActiveSpan(spanArgs.name, spanArgs.options, spanArgs.context, wrappedFn);

            if (spanArgs.options !== void 0)
              return target.startActiveSpan(spanArgs.name, spanArgs.options, wrappedFn);

            return target.startActiveSpan(spanArgs.name, wrappedFn);
          };

        case "withActiveSpan":
          return (...args: any[]) => {
            const spanArgs = normalizeSpanArgs(args);

            const cb = (span: Span) => {
              const wrappedSpan = createLangWatchSpan(span);

              try {
                const result = spanArgs.fn(wrappedSpan);

                // If result is a promise, handle it async
                if (result && typeof result.then === "function") {
                  return result
                    .then((result: any) => {
                      wrappedSpan.setStatus({
                        code: SpanStatusCode.OK,
                      });
                      return result;
                    })
                    .catch((err: any) => {
                      wrappedSpan.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: err?.message || String(err),
                      });
                      wrappedSpan.recordException?.(err);
                      throw err;
                    })
                    .finally(() => {
                      wrappedSpan.end();
                    });
                }

                // Sync result - end span and return
                wrappedSpan.setStatus({
                  code: SpanStatusCode.OK,
                });
                wrappedSpan.end();
                return result;
              } catch (err: any) {
                wrappedSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: err?.message || String(err),
                });
                wrappedSpan.recordException?.(err);
                wrappedSpan.end();
                throw err;
              }
            };

            // Call target.startActiveSpan to avoid double-wrapping
            if (spanArgs.context !== void 0)
              return target.startActiveSpan(spanArgs.name, spanArgs.options, spanArgs.context, cb);
            if (spanArgs.options !== void 0)
              return target.startActiveSpan(spanArgs.name, spanArgs.options, cb);

            return target.startActiveSpan(spanArgs.name, cb);
          };

        case "startSpan":
          return (name: string, options?: SpanOptions, context?: Context) =>
            createLangWatchSpan(target.startSpan(name, options, context));

        default: {
          const value = (target as any)[prop];

          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  };

  // See comment above about why.
  // eslint-disable-next-line prefer-const
  proxyInstance = new Proxy(tracer, handler) as LangWatchTracer;
  return proxyInstance;
}

/**
 * Normalizes the variable arguments passed to span methods.
 * Handles the following overloaded signatures:
 * - (name, fn)
 * - (name, options, fn)
 * - (name, options, context, fn)
 *
 * @param args - The arguments array from the span method
 * @returns An object with normalized name, options, context, and fn properties
 * @throws Error if no callback function is found in the arguments
 */
function normalizeSpanArgs(args: any[]) {
  const [name, arg2, arg3, arg4] = args;

  if (typeof arg4 === "function")
    return { name, options: arg2, context: arg3, fn: arg4 };

  if (typeof arg3 === "function") return { name, options: arg2, fn: arg3 };
  if (typeof arg2 === "function") return { name, fn: arg2 };

  throw new Error("Expected a span callback as the last argument");
}
