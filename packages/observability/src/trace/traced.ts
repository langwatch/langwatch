import { SpanStatusCode } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

/**
 * Wraps every method of a service instance with an OTEL span named
 * `ClassName.methodName`.
 *
 * Apply once at factory time so individual service methods stay clean:
 *
 * ```ts
 * static create(options): TraceService {
 *   const service = TraceService.create(options);
 *   return traced(service, "TraceService");
 * }
 * ```
 *
 * Only own, non-constructor, function-valued properties are wrapped.
 * Inherited prototype methods are also wrapped via Reflect.get traversal.
 *
 * A wrapped method answers with the same shape the method itself answers with:
 * a promise stays a promise, and a plain value stays a plain value. The whole
 * class depends on that, because the proxy is also what `this` is bound to for
 * every internal call, so `this.helper()` has to stay readable as the helper's
 * own result.
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

      // Async generators cannot go through withActiveSpan. Calling one returns
      // an AsyncGenerator, not a promise, so `withActiveSpan(name, async () =>
      // fn())` resolves to a Promise<AsyncGenerator> — and `for await` on a
      // promise throws "not async iterable". The failure is silent at wrap
      // time and only surfaces when the method is iterated.
      //
      // So the span is managed by hand instead. withActiveSpan owns the whole
      // call and would close the span at the first yield; a generator's work
      // happens across every later next(), so what is worth measuring is the
      // iteration. `finally` covers all three ways a generator ends — drained,
      // thrown, or abandoned when a `for await` breaks and calls return().
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

      // The callback is deliberately not `async`. withActiveSpan decides what
      // to do from what the call actually returns: a thenable holds the span
      // open until it settles, anything else closes the span on the spot and is
      // handed back untouched. That covers a method returning a promise without
      // being declared `async` too, which still gets a span that lasts as long
      // as the work. Declaring the callback `async` takes the decision away and
      // makes every method answer with a promise, so a synchronous helper
      // reached as `this.helper()` silently becomes a `Promise<T>` where the
      // caller reads a `T`: arithmetic on it is NaN, interpolating it into a
      // cache key writes "[object Promise]", and every comparison against it is
      // false. Nothing throws, so the only symptom is wrong behavior elsewhere.
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const self = this ?? target;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return tracer.withActiveSpan(spanName, () =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
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
