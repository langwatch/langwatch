import { describe, expect, it } from "vitest";

import { isPrincipalKind, isStoredPrincipalKind } from "../vocabulary.ts";

describe("the vocabulary type guards", () => {
  describe("given an inherited Object.prototype key", () => {
    it("rejects it rather than narrowing it to a member", () => {
      // `"constructor" in {}` and `"toString" in {}` are both true, so a
      // guard written with `in` would narrow these untrusted strings to a
      // principal kind whose table lookup then yields a function.
      for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
        expect(isPrincipalKind(key)).toBe(false);
        expect(isStoredPrincipalKind(key)).toBe(false);
      }
    });
  });

  describe("given a real member name", () => {
    it("accepts the principal spellings the table actually holds", () => {
      expect(isPrincipalKind("user")).toBe(true);
    });
  });
});
