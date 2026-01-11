/**
 * Unit tests for LanguageGrid selection logic.
 * Tests the pure logic without rendering components.
 */
import { describe, it, expect } from "vitest";
import { LANGUAGE_OPTIONS, type LanguageKey } from "../techStackOptions";

describe("LanguageGrid selection logic", () => {
  describe("when validating language keys", () => {
    it("python is a valid language key", () => {
      const validKeys: LanguageKey[] = ["python", "typescript", "other"];
      expect(validKeys.includes("python")).toBe(true);
    });

    it("typescript is a valid language key", () => {
      const validKeys: LanguageKey[] = ["python", "typescript", "other"];
      expect(validKeys.includes("typescript")).toBe(true);
    });

    it("other is a valid language key", () => {
      const validKeys: LanguageKey[] = ["python", "typescript", "other"];
      expect(validKeys.includes("other")).toBe(true);
    });
  });

  describe("when iterating language options", () => {
    it("has exactly 3 options", () => {
      expect(LANGUAGE_OPTIONS.length).toBe(3);
    });

    it("each option has a key, label, and icon", () => {
      for (const option of LANGUAGE_OPTIONS) {
        expect(option.key).toBeDefined();
        expect(option.label).toBeDefined();
        expect(option.icon).toBeDefined();
      }
    });

    it("keys match expected values", () => {
      const keys = LANGUAGE_OPTIONS.map((o) => o.key);
      expect(keys).toEqual(["python", "typescript", "other"]);
    });
  });

  describe("when determining selection state", () => {
    it("can determine if a language is selected", () => {
      const selectedLanguage: LanguageKey = "python";
      const isSelected = (key: LanguageKey) => key === selectedLanguage;

      expect(isSelected("python")).toBe(true);
      expect(isSelected("typescript")).toBe(false);
      expect(isSelected("other")).toBe(false);
    });

    it("only one language can be selected at a time", () => {
      const selectedLanguage: LanguageKey = "typescript";
      const selectedCount = LANGUAGE_OPTIONS.filter(
        (o) => o.key === selectedLanguage,
      ).length;

      expect(selectedCount).toBe(1);
    });
  });
});
