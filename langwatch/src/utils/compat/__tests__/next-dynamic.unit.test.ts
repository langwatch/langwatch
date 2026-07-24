/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

vi.unmock("~/utils/compat/next-dynamic");
import { resolveModule } from "../next-dynamic";

describe("resolveModule()", () => {
  describe("when module has ES default export (function)", () => {
    it("returns the function as default", () => {
      const MyComponent = () => null;
      const result = resolveModule({ default: MyComponent });
      expect(result.default).toBe(MyComponent);
    });
  });

  describe("when module is a CJS module wrapped by Vite", () => {
    it("unwraps { default: componentFn } to find the function", () => {
      const MyComponent = () => null;
      const result = resolveModule({ default: MyComponent });
      expect(result.default).toBe(MyComponent);
    });
  });

  describe("when module is double-wrapped CJS", () => {
    it("resolves through { default: { default: componentFn } }", () => {
      const MyComponent = () => null;
      const result = resolveModule({ default: { default: MyComponent } });
      expect(result.default).toBe(MyComponent);
    });
  });

  describe("when module default is a non-function object (UMD)", () => {
    it("returns the object as fallback", () => {
      const moduleObj = { reactJsonView: () => null, someOther: "thing" };
      const result = resolveModule({ default: moduleObj });
      // moduleObj is not a function, and moduleObj.default is undefined,
      // so it falls through to the fallback
      expect(result.default).toBe(moduleObj);
    });
  });

  describe("when module itself is the component (no wrapping)", () => {
    it("returns the function as default", () => {
      const MyComponent = () => null;
      const result = resolveModule(MyComponent);
      expect(result.default).toBe(MyComponent);
    });
  });

  describe("when module is null/undefined", () => {
    it("handles null gracefully", () => {
      const result = resolveModule(null);
      expect(result.default).toBeNull();
    });

    it("handles undefined gracefully", () => {
      const result = resolveModule(undefined);
      expect(result.default).toBeUndefined();
    });
  });
});
