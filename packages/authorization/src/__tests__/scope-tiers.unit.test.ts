import { describe, expect, it } from "vitest";

import { isDeclaredScopeTier, isScopeTier, isStoredScopeTier } from "../scope-tiers.ts";

describe("the scope tier type guards", () => {
  describe("given an inherited Object.prototype key", () => {
    it("rejects it rather than narrowing it to a tier", () => {
      // `"constructor" in {}` and `"toString" in {}` are both true, so a
      // guard written with `in` would narrow these untrusted strings to a
      // tier whose table lookup then yields a function.
      for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
        expect(isScopeTier(key)).toBe(false);
        expect(isStoredScopeTier(key)).toBe(false);
        expect(isDeclaredScopeTier(key)).toBe(false);
      }
    });
  });

  describe("given a real member name", () => {
    it("accepts the tier spellings the table actually holds", () => {
      expect(isScopeTier("project")).toBe(true);
      expect(isScopeTier("organization")).toBe(true);
      expect(isDeclaredScopeTier("team")).toBe(true);
      expect(isDeclaredScopeTier("platform")).toBe(false);
    });
  });
});
