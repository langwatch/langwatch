/**
 * Creates a proxy that wraps any matching methods of the target
 * with the methods of the decorator. All methods not present on
 * both the target and the decorator remain unchanged.
 * Additonal decorator methods are ignored.
 *
 * @param target - The target to wrap.
 * @param DecoratorClass - The decorator class to use.
 * @returns A proxy that wraps the target and
 * adds tracing to the methods of the decorator.
 */
export function createTracingProxy<T extends object, D extends Partial<T>>(
  target: T,
  DecoratorClass: new (target: T) => D,
): T {
  const decorator = new DecoratorClass(target);

  return new Proxy(target, {
    get(target, prop, receiver) {
      // Check if decorator has this method
      if (prop in decorator) {
        return decorator[prop as keyof D];
      }

      // Fall back to original target
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}
