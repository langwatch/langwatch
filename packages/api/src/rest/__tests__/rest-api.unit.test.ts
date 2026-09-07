import { Hono } from "hono";
import { describe, expect, expectTypeOf, it } from "vitest";
import { restApi } from "../rest-api.ts";

describe("restApi", () => {
  it("preserves the native router factory and does not invoke it", () => {
    let calls = 0;
    const router = (mount: Hono) => {
      calls += 1;
      return mount;
    };

    const descriptor = restApi({ router });

    expect(descriptor).toEqual({ protocol: "rest", router });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(descriptor.router).toBe(router);
    expect(calls).toBe(0);
    expectTypeOf(descriptor.router).toEqualTypeOf<typeof router>();
  });
});
