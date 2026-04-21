import { describe, expect, it } from "vitest";
import { clampMaxTokens } from "../clampMaxTokens";

describe("clampMaxTokens", () => {
  describe("when value is undefined", () => {
    it("returns undefined regardless of ceiling", () => {
      expect(clampMaxTokens(undefined, 4096)).toBeUndefined();
      expect(clampMaxTokens(undefined, undefined)).toBeUndefined();
    });
  });

  describe("when ceiling is missing or non-positive", () => {
    it("passes the value through unchanged", () => {
      expect(clampMaxTokens(999999, undefined)).toBe(999999);
      expect(clampMaxTokens(8192, 0)).toBe(8192);
      expect(clampMaxTokens(8192, -1)).toBe(8192);
    });
  });

  describe("when value is below ceiling", () => {
    it("keeps the value", () => {
      expect(clampMaxTokens(4096, 8192)).toBe(4096);
    });
  });

  describe("when value exceeds ceiling", () => {
    it("clamps down to ceiling", () => {
      expect(clampMaxTokens(128000, 8192)).toBe(8192);
    });
  });

  describe("when value equals ceiling", () => {
    it("returns the ceiling", () => {
      expect(clampMaxTokens(8192, 8192)).toBe(8192);
    });
  });
});
