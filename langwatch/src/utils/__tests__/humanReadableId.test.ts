import { describe, expect, it } from "vitest";
import { generateHumanReadableId } from "../humanReadableId";

describe("humanReadableId", () => {
  describe("generateHumanReadableId", () => {
    it("generates an ID with adjective-adjective-noun format (3 words)", () => {
      const id = generateHumanReadableId();

      // Should match pattern like "swift-bright-fox" (3 words, no numbers)
      expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

      // Verify it has exactly 3 parts
      const parts = id.split("-");
      expect(parts).toHaveLength(3);
    });

    it("uses custom separator", () => {
      const id = generateHumanReadableId({ separator: "_" });

      // Should match pattern like "swift_bright_fox"
      expect(id).toMatch(/^[a-z]+_[a-z]+_[a-z]+$/);
    });

    it("generates different IDs on subsequent calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateHumanReadableId());
      }
      // Should have mostly unique IDs (allowing for some collisions)
      // With ~50 adjectives and ~50 nouns, we have ~125,000 combinations
      expect(ids.size).toBeGreaterThan(80);
    });

    it("does not use the same adjective twice", () => {
      // Run multiple times to increase confidence
      for (let i = 0; i < 50; i++) {
        const id = generateHumanReadableId();
        const parts = id.split("-");
        expect(parts[0]).not.toBe(parts[1]);
      }
    });

    it("does not include any numbers", () => {
      for (let i = 0; i < 50; i++) {
        const id = generateHumanReadableId();
        expect(id).not.toMatch(/\d/);
      }
    });
  });
});
