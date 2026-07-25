import { describe, expect, it } from "vitest";
import { shouldPruneToProd } from "../../src/services/node-deps.ts";

describe("pruning to production dependencies", () => {
  const paths = { app: "/home/u/.langwatch/app" };

  describe("when the app tree is the relocated copy", () => {
    it("prunes", () => {
      expect(shouldPruneToProd("/home/u/.langwatch/app/langwatch", paths)).toBe(true);
    });
  });

  describe("when the app tree is a developer checkout", () => {
    it("leaves it alone", () => {
      // Pruning a working tree would strip the developer's own test and
      // build tooling out from under them.
      expect(shouldPruneToProd("/home/u/Projects/langwatch/langwatch", paths)).toBe(false);
    });

    it("is not fooled by a sibling directory sharing the prefix", () => {
      expect(shouldPruneToProd("/home/u/.langwatch/apple/langwatch", paths)).toBe(false);
    });
  });
});
