import { SpanKind } from "@opentelemetry/api";

import { type LangWatchSpan, type LangWatchTracer } from "@/observability-sdk";

// Type for decorator methods that receive span as first parameter
type DecoratorMethodWithSpan<T extends (...args: never[]) => unknown> = (
  span: LangWatchSpan,
  ...args: Parameters<T>
) => ReturnType<T>;

// Type for decorator class that maps original methods to span-aware versions
// Only requires methods that are actually implemented in the decorator
type DecoratorClass<T> = new (target: T) => Partial<{
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? DecoratorMethodWithSpan<T[K]> : T[K];
}>;

/**
 * Creates a proxy that always creates spans for public methods.
 * @param target - The target to wrap
 * @param tracer - The tracer instance to use
 * @param DecoratorClass - Optional decorator class for custom logic
 * @returns A proxy that wraps the target with consistent tracing
 */
export function createTracingProxy<
  T extends object,
  D extends DecoratorClass<T> | undefined = undefined,
>(target: T, tracer: LangWatchTracer, DecoratorClass?: D): T {
  const decorator = DecoratorClass ? new DecoratorClass(target) : null;

  return new Proxy(target, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // If it's not a function, return as-is
      if (typeof value !== "function") {
        return value;
      }

      if (typeof prop !== "string" || prop.startsWith("_")) {
        return value.bind(target);
      }
      if (isGetterOrSetter(target, prop)) {
        return value.bind(target);
      }
      if (isBuiltInMethod(prop)) {
        return value.bind(target);
      }

      return (...args: unknown[]) => {
        const spanName = `${target.constructor.name}.${prop}`;

        return tracer.withActiveSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "code.function": prop,
              "code.namespace": target.constructor.name,
            },
          },
          (span) => {
            const decoratorMethod = findDecoratorMethod(decorator, prop);
            if (decoratorMethod) {
              return decoratorMethod.apply(decorator, [span, ...args]);
            }

            return value.apply(target, args);
          },
        );
      };
    },
  });
}

// Helper function to check if a property is a getter or setter
const isGetterOrSetter = (target: object, prop: string | symbol): boolean => {
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
  return descriptor?.get !== undefined || descriptor?.set !== undefined;
};

// Helper function to check if a method is a built-in method that should not be traced
const isBuiltInMethod = (prop: string | symbol): boolean => {
  if (typeof prop !== "string") {
    return false;
  }

  // List of built-in methods that should not be traced
  const builtInMethods = [
    "toString",
    "valueOf",
    "toJSON",
    "toLocaleString",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "constructor",
  ];

  return builtInMethods.includes(prop);
};

function findDecoratorMethod(decorator: object | null, prop: string) {
  if (!decorator || !(prop in decorator)) return void 0;
  const method = Reflect.get(decorator, prop);
  return typeof method === "function" ? method : void 0;
}
