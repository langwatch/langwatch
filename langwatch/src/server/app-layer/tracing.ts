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

      const spanName = `${className}.${String(prop)}`;

      return function (this: unknown, ...args: unknown[]) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return tracer.withActiveSpan(spanName, async () =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
          (value as (...a: unknown[]) => unknown).apply(
            this ?? target,
            args,
          ),
        );
      };
    },
  });
}
