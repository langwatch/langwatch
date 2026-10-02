/** Missing methods throw when called, so adding a dependency cannot silently pass a test. */
export function createApiDouble<Api extends object>(
  overrides: Partial<Api> = {},
  name = "API double",
): Api {
  const target: Api = Object.create(null);
  Object.assign(target, overrides);
  return new Proxy(target, {
    get(held, property, receiver) {
      if (Reflect.has(held, property)) {
        return Reflect.get(held, property, receiver);
      }
      if (property === "then" || typeof property === "symbol") {
        return void 0;
      }
      return () => {
        throw new Error(`${name}.${property} is not configured for this test`);
      };
    },
  });
}
