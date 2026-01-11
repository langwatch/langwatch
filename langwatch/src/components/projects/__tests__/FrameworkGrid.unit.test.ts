/**
 * Unit tests for FrameworkGrid filtering logic.
 * Tests the pure logic without rendering components.
 */
import { describe, it, expect } from "vitest";
import {
  FRAMEWORK_OPTIONS,
  getFrameworksForLanguage,
  getDefaultFramework,
  isFrameworkAvailableForLanguage,
  type FrameworkKey,
  type LanguageKey,
} from "../techStackOptions";

describe("FrameworkGrid filtering logic", () => {
  describe("when filtering frameworks by Python", () => {
    it("includes OpenAI", () => {
      const frameworks = getFrameworksForLanguage("python");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("openai");
    });

    it("includes LangChain", () => {
      const frameworks = getFrameworksForLanguage("python");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("langchain");
    });

    it("includes DSPy", () => {
      const frameworks = getFrameworksForLanguage("python");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("dspy");
    });

    it("excludes Vercel AI SDK", () => {
      const frameworks = getFrameworksForLanguage("python");
      const keys = frameworks.map((f) => f.key);
      expect(keys).not.toContain("vercel_ai");
    });
  });

  describe("when filtering frameworks by TypeScript", () => {
    it("includes OpenAI", () => {
      const frameworks = getFrameworksForLanguage("typescript");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("openai");
    });

    it("includes Vercel AI SDK", () => {
      const frameworks = getFrameworksForLanguage("typescript");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("vercel_ai");
    });

    it("includes LangChain", () => {
      const frameworks = getFrameworksForLanguage("typescript");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toContain("langchain");
    });

    it("excludes DSPy", () => {
      const frameworks = getFrameworksForLanguage("typescript");
      const keys = frameworks.map((f) => f.key);
      expect(keys).not.toContain("dspy");
    });
  });

  describe("when filtering frameworks by Other", () => {
    it("only includes Other framework", () => {
      const frameworks = getFrameworksForLanguage("other");
      const keys = frameworks.map((f) => f.key);
      expect(keys).toEqual(["other"]);
    });
  });

  describe("when getting default framework", () => {
    it("returns openai for python", () => {
      expect(getDefaultFramework("python")).toBe("openai");
    });

    it("returns openai for typescript", () => {
      expect(getDefaultFramework("typescript")).toBe("openai");
    });

    it("returns other for other", () => {
      expect(getDefaultFramework("other")).toBe("other");
    });
  });

  describe("when checking framework availability", () => {
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

  describe("when validating framework options structure", () => {
    it("each framework has availableFor array", () => {
      for (const framework of FRAMEWORK_OPTIONS) {
        expect(Array.isArray(framework.availableFor)).toBe(true);
        expect(framework.availableFor.length).toBeGreaterThan(0);
      }
    });

    it("each framework has key, label, and icon", () => {
      for (const framework of FRAMEWORK_OPTIONS) {
        expect(framework.key).toBeDefined();
        expect(framework.label).toBeDefined();
        expect(framework.icon).toBeDefined();
      }
    });
  });
});
