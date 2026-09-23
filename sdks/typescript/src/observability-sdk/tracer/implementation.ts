import {
  type Span,
  type SpanOptions,
  type Context,
  SpanStatusCode,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";

import { emitEvaluationEvent, type AddEvaluationParams } from "../evaluation";
import { createLangWatchSpan } from "../span";
import { type LangWatchTracer } from "./types";

/**
 * @param name - Tracer name (service or library)
 * @param version - Optional version identifier
 * @returns A LangWatch tracer with enhanced functionality
 */
export function getLangWatchTracer(name: string, version?: string): LangWatchTracer {
  return getLangWatchTracerFromProvider(trace.getTracerProvider(), name, version);
}

/**
 * @param tracerProvider - The OpenTelemetry tracer provider to use
 * @param name - Tracer name (service or library)
 * @param version - Optional version identifier
 * @returns A LangWatch tracer with enhanced functionality
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
            const options = withDefaultOrigin(spanArgs.options);

            const wrappedFn = (span: Span, ...cbArgs: any[]) =>
              spanArgs.fn(createLangWatchSpan(span), ...cbArgs);

            if (spanArgs.context !== void 0)
              return target.startActiveSpan(spanArgs.name, options, spanArgs.context, wrappedFn);

            return target.startActiveSpan(spanArgs.name, options, wrappedFn);
          };

        case "withActiveSpan":
          return (...args: any[]) => {
            const spanArgs = normalizeSpanArgs(args);
            const optionsWithOrigin = withDefaultOrigin(spanArgs.options);

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
                        message: err?.message ?? String(err),
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
                  message: err?.message ?? String(err),
                });
                wrappedSpan.recordException?.(err);
                wrappedSpan.end();
                throw err;
              }
            };

            // Call target.startActiveSpan to avoid double-wrapping
            if (spanArgs.context !== void 0)
              return target.startActiveSpan(spanArgs.name, optionsWithOrigin, spanArgs.context, cb);

            return target.startActiveSpan(spanArgs.name, optionsWithOrigin, cb);
          };

        case "startSpan":
          return (name: string, options?: SpanOptions, context?: Context) =>
            createLangWatchSpan(target.startSpan(name, withDefaultOrigin(options), context));

        case "addEvaluation":
          return (params: AddEvaluationParams) => {
            const activeSpan = trace.getActiveSpan();
            if (!activeSpan) return;
            emitEvaluationEvent(activeSpan, params);
          };

        default: {
          const value = Reflect.get(target, prop);

          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  };

  // See comment above about why.
  proxyInstance = new Proxy(tracer, handler) as LangWatchTracer;
  return proxyInstance;
}

/**
 * Normalizes the variable-arg overloads of a span method: (name, fn),
 * (name, options, fn), or (name, options, context, fn). Throws if no
 * callback is found.
 */
function normalizeSpanArgs(args: any[]) {
  const [name, arg2, arg3, arg4] = args;

  if (typeof arg4 === "function") return { name, options: arg2, context: arg3, fn: arg4 };

  if (typeof arg3 === "function") return { name, options: arg2, fn: arg3 };
  if (typeof arg2 === "function") return { name, fn: arg2 };

  throw new Error("Expected a span callback as the last argument");
}

/**
 * Injects `langwatch.origin = "application"` into span options unless the
 * caller already set one -- so experiments (`"evaluation"`) aren't overridden.
 */
function withDefaultOrigin(options?: SpanOptions): SpanOptions {
  const existing = options?.attributes?.["langwatch.origin"];
  if (existing) return options ?? {};

  return {
    ...options,
    attributes: {
      ...options?.attributes,
      "langwatch.origin": "application",
    },
  };
}
