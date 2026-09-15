import { SpanStatusCode } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

/**
 * Wraps every method of a service instance with an OTEL span named
 * `ClassName.methodName`: preserves return value shape.
 */
export function traced<T extends object>(instance: T, className: string): T {
  const tracer = getLangWatchTracer(`langwatch.${className.toLowerCase()}`);
  const wrapperCache = new Map<string | symbol, (this: unknown, ...args: unknown[]) => unknown>();

  return new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;

      if (typeof value !== "function" || prop === "constructor" || typeof prop === "symbol") {
        return value;
      }

      const cached = wrapperCache.get(prop);
      if (cached) return cached;

      const spanName = `${className}.${String(prop)}`;

      // Async generators need manual span management: withActiveSpan closes at
      // first yield, but a generator's work happens across every later next().
      if (isAsyncGeneratorFunction(value)) {
        const generatorWrapper = async function* (this: unknown, ...args: unknown[]) {
          const span = tracer.startSpan(spanName);
          try {
            yield* (value as (...a: unknown[]) => AsyncGenerator<unknown>).apply(
              this ?? target,
              args,
            );
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        };
        wrapperCache.set(prop, generatorWrapper);
        return generatorWrapper;
      }

      // Callback is not async so withActiveSpan can preserve the return value
      // shape (promise stays promise, plain value stays plain).
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const self = this ?? target;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return tracer.withActiveSpan(spanName, () =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          (value as (...a: unknown[]) => unknown).apply(self, args),
        );
      };
      wrapperCache.set(prop, wrapper);
      return wrapper;
    },
  });
}

/**
 * True for `async function*` declarations.
 *
 * Checked by constructor name rather than `instanceof` because the
 * AsyncGeneratorFunction constructor is not a global binding.
 */
function isAsyncGeneratorFunction(value: unknown): boolean {
  return typeof value === "function" && value.constructor?.name === "AsyncGeneratorFunction";
}
