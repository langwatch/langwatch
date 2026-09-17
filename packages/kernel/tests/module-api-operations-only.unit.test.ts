import { describe, expect, it } from "vitest";

import { moduleApi } from "../src/index.ts";

/**
 * The feature-API proxy serves operations only: a plain property read through
 * it throws "exposes operations only" at request time. Four interfaces
 * declared one anyway before the constraint existed (gateway, trace,
 * searchBodySchema, and auth's `baseUrl`, which broke sign-in on
 * 2026-09-14). `moduleApi` now refuses such an interface at compile time, so
 * the mistake fails the build instead of the first caller.
 */
describe("given a feature API declared through moduleApi", () => {
  describe("when every member is an operation", () => {
    it("accepts the interface", () => {
      interface AllOperations {
        readThing: (input: { id: string }) => Promise<string>;
        baseUrl: () => string;
        optional?: () => number;
      }
      const token = moduleApi<AllOperations>()("trace");
      expect(token.name).toBe("trace");
    });
  });

  describe("when a member is a plain property", () => {
    it("rejects the interface at compile time", () => {
      interface CarriesAProperty {
        readThing: (input: { id: string }) => Promise<string>;
        baseUrl: string;
      }
      // @ts-expect-error -- `baseUrl: string` is not an operation; the proxy
      // would throw on its first read, so the token refuses the shape.
      const token = moduleApi<CarriesAProperty>()("trace");
      expect(token.name).toBe("trace");
    });
  });

  describe("when a member is a non-callable object", () => {
    it("rejects the interface at compile time", () => {
      interface CarriesAnObject {
        readThing: (input: { id: string }) => Promise<string>;
        limits: { maxItems: number };
      }
      // @ts-expect-error -- an object-valued member is a property, not an
      // operation, and dies the same death at the proxy.
      const token = moduleApi<CarriesAnObject>()("trace");
      expect(token.name).toBe("trace");
    });
  });
});
