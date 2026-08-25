import { describe, expect, it } from "vitest";
import {
  isPrincipalKind,
  isScopeTier,
  isStoredPrincipalKind,
  isStoredScopeTier,
} from "../src/vocabulary";

describe("the vocabulary type guards", () => {
  describe("given an inherited Object.prototype key", () => {
    it("rejects it rather than narrowing it to a member", () => {
      // `"constructor" in {}` and `"toString" in {}` are both true, so a
      // guard written with `in` would narrow these untrusted strings to a
      // tier or principal kind whose table lookup then yields a function.
      for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
        expect(isScopeTier(key)).toBe(false);
        expect(isStoredScopeTier(key)).toBe(false);
        expect(isPrincipalKind(key)).toBe(false);
        expect(isStoredPrincipalKind(key)).toBe(false);
      }
    });
  });

  describe("given a real member name", () => {
    it("accepts the tier and principal spellings the tables actually hold", () => {
      expect(isScopeTier("project")).toBe(true);
      expect(isScopeTier("organization")).toBe(true);
      expect(isPrincipalKind("user")).toBe(true);
    });
  });
});
