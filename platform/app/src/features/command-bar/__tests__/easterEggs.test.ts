import { describe, it, expect } from "vitest";
import { findEasterEgg, easterEggs } from "../easterEggs";

describe("easterEggs", () => {
  describe("findEasterEgg", () => {
    it("finds confetti easter egg with exact match", () => {
      const result = findEasterEgg("confetti");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-confetti");
      expect(result?.effect).toBe("confetti");
    });

    it("finds confetti easter egg with party trigger", () => {
      const result = findEasterEgg("party");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-confetti");
    });

    it("finds confetti easter egg with emoji", () => {
      const result = findEasterEgg("🎉");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-confetti");
    });

    it("finds barrel roll easter egg", () => {
      const result = findEasterEgg("barrel roll");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-barrel-roll");
      expect(result?.effect).toBe("barrelRoll");
      expect(result?.keepOpen).toBe(true);
    });

    it("finds barrel roll with 'do a barrel roll'", () => {
      const result = findEasterEgg("do a barrel roll");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-barrel-roll");
    });

    it("finds 42 easter egg", () => {
      const result = findEasterEgg("42");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-42");
      expect(result?.effect).toBe("toast");
      expect(result?.toastMessage).toBe(
        "The answer to life, the universe, and everything."
      );
    });

    it("finds 42 easter egg with 'meaning of life'", () => {
      const result = findEasterEgg("meaning of life");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("easter-42");
    });

    it("returns null for non-easter egg queries", () => {
      expect(findEasterEgg("settings")).toBeNull();
      expect(findEasterEgg("traces")).toBeNull();
      expect(findEasterEgg("random text")).toBeNull();
    });

    it("handles case insensitively", () => {
      expect(findEasterEgg("CONFETTI")).not.toBeNull();
      expect(findEasterEgg("Barrel Roll")).not.toBeNull();
    });

    it("handles whitespace", () => {
      expect(findEasterEgg("  confetti  ")).not.toBeNull();
      expect(findEasterEgg("  42  ")).not.toBeNull();
    });
  });

  describe("easterEggs registry", () => {
    it("has all required fields for each easter egg", () => {
      easterEggs.forEach((egg) => {
        expect(egg.id).toBeDefined();
        expect(egg.triggers).toBeDefined();
        expect(egg.triggers.length).toBeGreaterThan(0);
        expect(egg.label).toBeDefined();
        expect(egg.icon).toBeDefined();
        expect(egg.effect).toBeDefined();
        expect(["confetti", "barrelRoll", "toast"]).toContain(egg.effect);
      });
    });

    it("barrel roll has keepOpen flag", () => {
      const barrelRoll = easterEggs.find(
        (egg) => egg.id === "easter-barrel-roll"
      );
      expect(barrelRoll?.keepOpen).toBe(true);
    });
  });
});
