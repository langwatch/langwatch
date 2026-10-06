/** Missing methods throw when called, so adding a dependency cannot silently pass a test. */
export function createApiFixture<Api extends object>(
  overrides: Partial<Api> = {},
  name = "API fixture",
): Api {
  return new Proxy({ ...overrides } as Api, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
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
