import { describe, expect, it } from "vitest";
import { generateCustomGraphId } from "../customGraphId";

describe("generateCustomGraphId()", () => {
  describe("when generating many ids", () => {
    it("never starts with '-' or '_'", () => {
      for (let i = 0; i < 2000; i++) {
        const id = generateCustomGraphId();
        expect(id.startsWith("-")).toBe(false);
        expect(id.startsWith("_")).toBe(false);
      }
    });

    it("still produces the standard nanoid length", () => {
      const id = generateCustomGraphId();
      expect(id).toHaveLength(21);
    });
  });
});
