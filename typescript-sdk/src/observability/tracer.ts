import {
  trace as otelTrace,
  Tracer,
  Span,
  SpanOptions,
  Context,
  SpanStatusCode,
} from "@opentelemetry/api";
import { LangWatchSpan, createLangWatchSpan } from "./span";

/**
 * LangWatch OpenTelemetry Tracing Extensions
 *
 * This module provides wrappers and helpers for OpenTelemetry Tracer and Span objects,
 * adding ergonomic methods for LLM/GenAI observability and structured tracing.
 *
 * @module tracer
 */
export interface LangWatchTracer extends Tracer {
  /**
   * Starts a new {@link LangWatchSpan}. Start the span without setting it on context.
   *
   * This method does NOT modify the current Context.
   *
   * @param name The name of the span
   * @param [options] SpanOptions used for span creation
   * @param [context] Context to use to extract parent
   * @returns LangWatchSpan The newly created span
   *
   * @example
   *     const span = tracer.startSpan('op');
   *     span.setAttribute('key', 'value');
   *     span.end();
   */
  startSpan(
    name: string,
    options?: SpanOptions,
    context?: Context,
  ): LangWatchSpan;

  /**
   * Starts a new {@link LangWatchSpan} and calls the given function passing it the
   * created span as first argument.
   * Additionally the new span gets set in context and this context is activated
   * for the duration of the function call.
   *
   * @param name The name of the span
   * @param [options] SpanOptions used for span creation
   * @param [context] Context to use to extract parent
   * @param fn function called in the context of the span and receives the newly created span as an argument
   * @returns return value of fn
   *
   * @example
   *     const result = tracer.startActiveSpan('op', span => {
   *       try {
   *         // do some work
   *         span.setStatus({code: SpanStatusCode.OK});
   *         return something;
   *       } catch (err) {
   *         span.setStatus({
   *           code: SpanStatusCode.ERROR,
   *           message: err.message,
   *         });
   *         throw err;
   *       } finally {
   *         span.end();
   *       }
   *     });
   *
   * @example
   *     const span = tracer.startActiveSpan('op', span => {
   *       try {
   *         do some work
   *         return span;
   *       } catch (err) {
   *         span.setStatus({
   *           code: SpanStatusCode.ERROR,
   *           message: err.message,
   *         });
   *         throw err;
   *       }
   *     });
   *     do some more work
   *     span.end();
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;

  /**
   * Starts a new {@link LangWatchSpan}, runs the provided async function, and automatically handles
   * error recording, status setting, and span ending. This is a safer and more ergonomic alternative
   * to manually using try/catch/finally blocks with startActiveSpan.
   *
   * Overloads:
   * - withActiveSpan(name, fn)
   * - withActiveSpan(name, options, fn)
   * - withActiveSpan(name, options, context, fn)
   *
   * @param name The name of the span
   * @param options Optional SpanOptions for span creation
   * @param context Optional Context to use to extract parent
   * @param fn   The async function to execute within the span context. Receives the span as its first argument.
   * @returns The return value of the provided function
   *
   * @example
   *   await tracer.withActiveSpan('my-operation', async (span) => {
   *     // ... your code ...
   *   });
   *
   *   await tracer.withActiveSpan('my-operation', { attributes: { foo: 'bar' } }, async (span) => {
   *     // ... your code ...
   *   });
   *
   *   await tracer.withActiveSpan('my-operation', { attributes: { foo: 'bar' } }, myContext, async (span) => {
   *     // ... your code ...
   *   });
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
}

/**
 * Extension of OpenTelemetry's Tracer with LangWatch-specific helpers.
 *
 * This interface provides methods for starting spans and active spans that return LangWatchSpan objects,
 * which include ergonomic helpers for LLM/GenAI tracing.
 *
 * @example
 * import { getLangWatchTracer } from 'langwatch';
 * const tracer = getLangWatchTracer('my-service');
 * const span = tracer.startSpan('llm-call');
 * span.setType('llm').setInput('Prompt').setOutput('Completion');
 * span.end();
 *
 * tracer.startActiveSpan('llm-call', (span) => {
 *   span.setType('llm');
 *   // ...
 *   span.end();
 * });
 */
export function getLangWatchTracer(name: string, version?: string): LangWatchTracer {
  const tracer = otelTrace.getTracer(name, version);

  // Create a proxy for the tracer that intercepts the calls to startActiveSpan and
  // startSpan, and wraps the span object with our custom LangWatchSpan.
  const handler: ProxyHandler<LangWatchTracer> = {
    get(target, prop, _receiver) {
      switch (prop) {
        case "startActiveSpan": {
          const startActiveSpan: StartActiveSpanOverloads = (
            ...args: [
              string,
              SpanOptions?,
              Context?,
              ((span: Span) => unknown)?,
            ]
          ) => {
            // Find the span callback function (usually the last argument!)
            const fnIndex = args.findIndex((arg) => typeof arg === "function");
            if (fnIndex === -1) {
              throw new Error(
                "startActiveSpan requires a function as the last argument",
              );
            }

            // A type assertion is safe here due to the check above, but still sad 😥
            const userFn = args[fnIndex] as (
              span: Span,
              ...rest: unknown[]
            ) => unknown;

            // Replace the function with one that wraps the span first
            const spanWrapFunc = (...fnArgs: unknown[]) => {
              const [span, ...rest] = fnArgs;
              return userFn(createLangWatchSpan(span as Span), ...rest);
            };

            const newArgs = [...args];
            newArgs[fnIndex] = spanWrapFunc;

            // TypeScript can't infer the overload, but this is safe
            return (
              target.startActiveSpan as unknown as (
                ...args: unknown[]
              ) => unknown
            )(...newArgs);
          };
          return startActiveSpan;
        }

        case "startSpan": {
          return function (
            ...args: Parameters<Tracer["startSpan"]>
          ): ReturnType<Tracer["startSpan"]> {
            const span = target.startSpan(...args);
            return createLangWatchSpan(span);
          };
        }

        case "withActiveSpan": {
          /**
           * Implementation of withActiveSpan: supports all overloads like startActiveSpan.
           * Uses startActiveSpan to ensure context propagation for nested spans.
           */
          return async function withActiveSpan(...args: any[]): Promise<any> {
            // Find the function argument (should be the last argument)
            const fnIndex = args.findIndex((arg) => typeof arg === "function");
            if (fnIndex === -1) {
              throw new Error("withActiveSpan requires a function as the last argument");
            }
            const userFn = args[fnIndex] as (span: LangWatchSpan) => Promise<any> | any;
            // The preceding arguments are: name, options?, context?
            const name = args[0];
            const options = args.length > 2 ? args[1] : undefined;
            const context = args.length > 3 ? args[2] : undefined;

            return await new Promise((resolve, reject) => {
              // Use startActiveSpan to ensure context propagation
              const cb = async (span: Span) => {
                const wrappedSpan = createLangWatchSpan(span);
                try {
                  resolve(await userFn(wrappedSpan));
                } catch (err: any) {
                  wrappedSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err && err.message ? err.message : String(err),
                  });
                  wrappedSpan.recordException(err);
                  reject(err);
                } finally {
                  wrappedSpan.end();
                }
              };
              // Call the correct overload of startActiveSpan
              if (context !== undefined) {
                target.startActiveSpan(name, options, context, cb);
              } else if (options !== undefined) {
                target.startActiveSpan(name, options, cb);
              } else {
                target.startActiveSpan(name, cb);
              }
            });
          };
        }

        default: {
          const value = target[prop as keyof Tracer];
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  };

  return new Proxy(tracer, handler) as LangWatchTracer;
}

/**
 * Helper type for the function overloads of startActiveSpan.
 *
 * This matches OpenTelemetry's Tracer interface and is used internally for type safety.
 */
type StartActiveSpanOverloads = {
  <F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
  <F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  <F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
};
