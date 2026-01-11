import { describe, it, expect } from "vitest";
import {
  LANGUAGE_OPTIONS,
  FRAMEWORK_OPTIONS,
  getFrameworksForLanguage,
  getDefaultFramework,
  isFrameworkAvailableForLanguage,
  type LanguageKey,
} from "../techStackOptions";

describe("techStackOptions", () => {
  describe("LANGUAGE_OPTIONS", () => {
    it("contains Python, TypeScript, and Other", () => {
      const keys = LANGUAGE_OPTIONS.map((l) => l.key);
      expect(keys).toEqual(["python", "typescript", "other"]);
    });

    it("each option has required properties", () => {
      for (const option of LANGUAGE_OPTIONS) {
        expect(option.key).toBeDefined();
        expect(option.label).toBeDefined();
        expect(option.icon).toBeDefined();
        expect(option.icon.type).toBe("single");
      }
    });
  });

  describe("FRAMEWORK_OPTIONS", () => {
    it("contains expected frameworks", () => {
      const keys = FRAMEWORK_OPTIONS.map((f) => f.key);
      expect(keys).toContain("openai");
      expect(keys).toContain("azure_openai");
      expect(keys).toContain("vercel_ai");
      expect(keys).toContain("langchain");
      expect(keys).toContain("dspy");
      expect(keys).toContain("other");
    });

    it("each option has availableFor array", () => {
      for (const option of FRAMEWORK_OPTIONS) {
        expect(Array.isArray(option.availableFor)).toBe(true);
        expect(option.availableFor.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getFrameworksForLanguage", () => {
    it("returns Python frameworks for python", () => {
      const frameworks = getFrameworksForLanguage("python");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("openai");
      expect(keys).toContain("langchain");
      expect(keys).toContain("dspy");
      expect(keys).not.toContain("vercel_ai");
    });

    it("returns TypeScript frameworks for typescript", () => {
      const frameworks = getFrameworksForLanguage("typescript");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("openai");
      expect(keys).toContain("vercel_ai");
      expect(keys).toContain("langchain");
      expect(keys).not.toContain("dspy");
    });

    it("returns only Other for other language", () => {
      const frameworks = getFrameworksForLanguage("other");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toEqual(["other"]);
    });
  });

  describe("getDefaultFramework", () => {
    it("returns first available framework for python", () => {
      const defaultFw = getDefaultFramework("python");
      expect(defaultFw).toBe("openai");
    });

    it("returns first available framework for typescript", () => {
      const defaultFw = getDefaultFramework("typescript");
      expect(defaultFw).toBe("openai");
    });

    it("returns other for other language", () => {
      const defaultFw = getDefaultFramework("other");
      expect(defaultFw).toBe("other");
    });
  });

  describe("isFrameworkAvailableForLanguage", () => {
    it("vercel_ai is available for typescript", () => {
      expect(isFrameworkAvailableForLanguage("vercel_ai", "typescript")).toBe(true);
    });

    it("vercel_ai is not available for python", () => {
      expect(isFrameworkAvailableForLanguage("vercel_ai", "python")).toBe(false);
    });

    it("dspy is available for python", () => {
      expect(isFrameworkAvailableForLanguage("dspy", "python")).toBe(true);
    });

    it("dspy is not available for typescript", () => {
      expect(isFrameworkAvailableForLanguage("dspy", "typescript")).toBe(false);
    });

    it("other is available for all languages", () => {
      const languages: LanguageKey[] = ["python", "typescript", "other"];
      for (const lang of languages) {
        expect(isFrameworkAvailableForLanguage("other", lang)).toBe(true);
      }
    });
  });
});
