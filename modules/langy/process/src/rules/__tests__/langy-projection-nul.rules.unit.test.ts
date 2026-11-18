import { describe, expect, it } from "vitest";

import { stripNulCharacters } from "../langy-projection-nul.rules.ts";

describe("stripNulCharacters", () => {
  describe("given a nested value with a NUL inside a string", () => {
    it("removes the NUL and leaves every other character as it was", () => {
      const value = {
        Role: "assistant",
        Parts: [{ type: "text", text: "a\u0000b\u0001 \\u0000 é" }],
        Count: 2,
        Plan: null,
      };

      expect(stripNulCharacters(value)).toEqual({
        Role: "assistant",
        Parts: [{ type: "text", text: "ab\u0001 \\u0000 é" }],
        Count: 2,
        Plan: null,
      });
    });
  });

  describe("given a value that is not a plain object", () => {
    it("passes it through as the same instance", () => {
      class Sentinel {}
      const sentinel = new Sentinel();

      expect(stripNulCharacters({ Plan: sentinel }).Plan).toBe(sentinel);
    });
  });
});
