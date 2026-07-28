import { getLangWatchTracer } from "langwatch";

/**
 * Wraps every method of a service instance with an OTEL span named
 * `ClassName.methodName`.
 *
 * Apply once at factory time so individual service methods stay clean:
 *
 * ```ts
 * static create(prisma: PrismaClient): TraceService {
 *   const service = new TraceService(...);
 *   return traced(service, "TraceService");
 * }
 * ```
 *
 * Only own, non-constructor, function-valued properties are wrapped.
 * Inherited prototype methods are also wrapped via Reflect.get traversal.
 */
export function traced<T extends object>(instance: T, className: string): T {
  const tracer = getLangWatchTracer(`langwatch.${className.toLowerCase()}`);
  const wrapperCache = new Map<
    string | symbol,
    (this: unknown, ...args: unknown[]) => unknown
  >();

  return new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;

      if (
        typeof value !== "function" ||
        prop === "constructor" ||
        typeof prop === "symbol"
      ) {
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
      // Delegating with `yield*` keeps the method a generator. The work is
      // still traced: every await inside it runs under whatever span is active
      // at iteration time, which for a streamed export is the request span.
      if (isAsyncGeneratorFunction(value)) {
        const generatorWrapper = async function* (
          this: unknown,
          ...args: unknown[]
        ) {
          yield* (
            value as (...a: unknown[]) => AsyncGenerator<unknown>
          ).apply(this ?? target, args);
        };
        wrapperCache.set(prop, generatorWrapper);
        return generatorWrapper;
      }

      const wrapper = function (this: unknown, ...args: unknown[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return tracer.withActiveSpan(spanName, async () =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
          (value as (...a: unknown[]) => unknown).apply(this ?? target, args),
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
  return (
    typeof value === "function" &&
    value.constructor?.name === "AsyncGeneratorFunction"
  );
}
