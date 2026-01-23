import { describe, expect, it } from "vitest";
import { generateEvaluatorSlug, isValidEvaluatorSlug } from "../evaluatorSlug";

describe("generateEvaluatorSlug", () => {
  it("should generate slug from simple name with format name-XXXXX", () => {
    const slug = generateEvaluatorSlug("My Custom Evaluator");
    expect(slug).toMatch(/^my-custom-evaluator-[a-z0-9]{5}$/);
  });

  it("should handle single word names", () => {
    const slug = generateEvaluatorSlug("Safety");
    expect(slug).toMatch(/^safety-[a-z0-9]{5}$/);
  });

  it("should handle names with special characters", () => {
    const slug = generateEvaluatorSlug("LLM Judge (v2.0) - Beta!");
    // slugify with strict: true removes special chars (dots are removed, not converted)
    expect(slug).toMatch(/^llm-judge-v20-beta-[a-z0-9]{5}$/);
  });

  it("should handle names with colons and question marks", () => {
    const slug = generateEvaluatorSlug("Question: What?");
    expect(slug).toMatch(/^question-what-[a-z0-9]{5}$/);
  });

  it("should handle names with underscores", () => {
    const slug = generateEvaluatorSlug("my_custom_eval");
    expect(slug).toMatch(/^my-custom-eval-[a-z0-9]{5}$/);
  });

  it("should handle names with ampersands", () => {
    const slug = generateEvaluatorSlug("Safety & Quality Check");
    // slugify with strict: true removes ampersands
    expect(slug).toMatch(/^safety-quality-check-[a-z0-9]{5}$/);
  });

  it("should handle names with numbers", () => {
    const slug = generateEvaluatorSlug("Evaluator v3.0");
    // slugify with strict: true removes dots
    expect(slug).toMatch(/^evaluator-v30-[a-z0-9]{5}$/);
  });

  it("should lowercase the slug", () => {
    const slug = generateEvaluatorSlug("UPPERCASE NAME");
    expect(slug).toMatch(/^uppercase-name-[a-z0-9]{5}$/);
  });

  it("should trim whitespace from name", () => {
    const slug = generateEvaluatorSlug("  Trimmed Name  ");
    expect(slug).toMatch(/^trimmed-name-[a-z0-9]{5}$/);
  });

  it("should throw error for empty name", () => {
    expect(() => generateEvaluatorSlug("")).toThrow(
      "Evaluator name cannot be empty",
    );
  });

  it("should throw error for whitespace-only name", () => {
    expect(() => generateEvaluatorSlug("   ")).toThrow(
      "Evaluator name cannot be empty",
    );
  });

  it("should truncate very long names", () => {
    const longName = "A".repeat(100);
    const slug = generateEvaluatorSlug(longName);
    // Base should be truncated to 50 chars max, plus hyphen and 5-char suffix
    expect(slug.length).toBeLessThanOrEqual(56);
    // Should end with a 5-char nanoid suffix
    expect(slug).toMatch(/-[a-z0-9]{5}$/);
  });

  it("should handle name that becomes empty after slugify", () => {
    // Name with only special chars that get removed
    const slug = generateEvaluatorSlug("!!!");
    // Should still return at least the nanoid suffix (5 chars)
    expect(slug).toHaveLength(5);
    expect(slug).toMatch(/^[a-z0-9]{5}$/);
  });

  it("should not end with hyphen before suffix", () => {
    // If truncation happens mid-word with hyphen at end
    const longName = "word-".repeat(20);
    const slug = generateEvaluatorSlug(longName);
    // Should not have double hyphen before suffix
    expect(slug).not.toContain("--");
  });

  it("should include 5-character nanoid suffix", () => {
    const slug = generateEvaluatorSlug("Test");
    // Suffix is 5 chars after last hyphen
    const parts = slug.split("-");
    expect(parts[parts.length - 1]).toHaveLength(5);
  });

  it("should generate unique slugs for same name", () => {
    const slug1 = generateEvaluatorSlug("Same Name");
    const slug2 = generateEvaluatorSlug("Same Name");

    // Base should be the same
    expect(slug1.startsWith("same-name-")).toBe(true);
    expect(slug2.startsWith("same-name-")).toBe(true);

    // But full slugs should be different due to nanoid
    expect(slug1).not.toBe(slug2);
  });
});

describe("isValidEvaluatorSlug", () => {
  it("should return true for valid slug", () => {
    expect(isValidEvaluatorSlug("my-custom-evaluator-abc12")).toBe(true);
  });

  it("should return true for simple valid slug", () => {
    expect(isValidEvaluatorSlug("safety-abc12")).toBe(true);
  });

  it("should return true for slug with numbers", () => {
    expect(isValidEvaluatorSlug("evaluator-v3-abc12")).toBe(true);
  });

  it("should return true for slug that is just nanoid", () => {
    expect(isValidEvaluatorSlug("abc12")).toBe(true);
  });

  it("should return false for empty string", () => {
    expect(isValidEvaluatorSlug("")).toBe(false);
  });

  it("should return false for slug with uppercase", () => {
    expect(isValidEvaluatorSlug("My-Evaluator-abc12")).toBe(false);
  });

  it("should return false for slug starting with hyphen", () => {
    expect(isValidEvaluatorSlug("-evaluator-abc12")).toBe(false);
  });

  it("should return false for slug ending with hyphen", () => {
    expect(isValidEvaluatorSlug("evaluator-abc12-")).toBe(false);
  });

  it("should return false for slug with consecutive hyphens", () => {
    expect(isValidEvaluatorSlug("my--evaluator-abc12")).toBe(false);
  });

  it("should return false for slug with special characters", () => {
    expect(isValidEvaluatorSlug("my_evaluator_abc12")).toBe(false);
    expect(isValidEvaluatorSlug("my.evaluator.abc12")).toBe(false);
  });

  it("should return false for slug too short", () => {
    expect(isValidEvaluatorSlug("abc")).toBe(false);
  });

  it("should return false for null or undefined", () => {
    expect(isValidEvaluatorSlug(null as any)).toBe(false);
    expect(isValidEvaluatorSlug(undefined as any)).toBe(false);
  });
});
