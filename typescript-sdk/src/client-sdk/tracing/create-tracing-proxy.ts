import { type LangWatchTracer } from "@/observability-sdk";
import { SpanKind } from "@opentelemetry/api";

// Type for decorator methods that receive span as first parameter
type DecoratorMethodWithSpan<T extends (...args: any[]) => any> =
  (span: any, ...args: Parameters<T>) => ReturnType<T>;

// Type for decorator class that maps original methods to span-aware versions
// Only requires methods that are actually implemented in the decorator
type DecoratorClass<T> = new (target: T) => Partial<{
    [K in keyof T]: T[K] extends (...args: any[]) => any
      ? DecoratorMethodWithSpan<T[K]>
      : T[K];
  }>;

/**
 * Creates a proxy that always creates spans for public methods.
 * Decorators can access the span as the first parameter to add additional attributes.
 *
 * @param target - The target to wrap
 * @param tracer - The tracer instance to use
 * @param DecoratorClass - Optional decorator class for custom logic
 * @returns A proxy that wraps the target with consistent tracing
 */
export function createTracingProxy<
  T extends object,
  D extends DecoratorClass<T> | undefined = undefined
>(
  target: T,
  tracer: LangWatchTracer,
  DecoratorClass?: D,
): T {
  const decorator = DecoratorClass ? new DecoratorClass(target) : null;

  return new Proxy(target, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // If it's not a function, return as-is
      if (typeof value !== "function") {
        return value;
      }

      // Only trace public methods
      if (
        typeof prop === "string" &&
        !prop.startsWith("_") && // Skip private methods
        !isGetterOrSetter(target, prop) && // Skip actual getters/setters
        prop !== "constructor" && // Skip constructor
        prop !== "toString" && // Skip built-in methods
        prop !== "valueOf" &&
        prop !== "toJSON"
      ) {
        return (...args: any[]) => {
          const spanName = `${target.constructor.name}.${prop}`;

          return tracer.withActiveSpan(spanName, {
            kind: SpanKind.CLIENT,
            attributes: {
              'code.function': prop,
              'code.namespace': target.constructor.name,
            },
          }, (span) => {
            // If decorator has this method, call it with span as first parameter
            if (decorator && prop in decorator) {
              const decoratorMethod = decorator[prop as keyof typeof decorator];
              if (typeof decoratorMethod === "function") {
                return decoratorMethod.apply(decorator, [span, ...args]);
              }
            }

            // Default: just call the original method
            return value.apply(target, args);
          });
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Helper function to check if a property is a getter or setter
const isGetterOrSetter = (target: any, prop: string | symbol): boolean => {
  // First check own properties
  let descriptor = Object.getOwnPropertyDescriptor(target, prop);

  // If not found on own properties, check prototype chain
  if (!descriptor) {
    const prototype = Object.getPrototypeOf(target);
    if (prototype) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, prop);
    }
  }

  // Return true if it's a getter or setter
  return !!(descriptor?.get ?? descriptor?.set);
};
