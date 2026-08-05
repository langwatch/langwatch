import { describe, expect, it } from "vitest";
import { generateEvaluatorSlug, isValidEvaluatorSlug } from "../evaluatorSlug";

describe("generateEvaluatorSlug", () => {
  /** @scenario Generate slug from evaluator name on creation */
  it("generates slug from simple name with format name-XXXXX", () => {
    const slug = generateEvaluatorSlug("My Custom Evaluator");
    expect(slug).toMatch(/^my-custom-evaluator-[a-z0-9]{5}$/);
  });

  it("handles single word names", () => {
    const slug = generateEvaluatorSlug("Safety");
    expect(slug).toMatch(/^safety-[a-z0-9]{5}$/);
  });

  /** @scenario Handle special characters in name */
  it("handles names with special characters", () => {
    const slug = generateEvaluatorSlug("LLM Judge (v2.0) - Beta!");
    // slugify with strict: true removes special chars (dots are removed, not converted)
    expect(slug).toMatch(/^llm-judge-v20-beta-[a-z0-9]{5}$/);
  });

  it("handles names with colons and question marks", () => {
    const slug = generateEvaluatorSlug("Question: What?");
    expect(slug).toMatch(/^question-what-[a-z0-9]{5}$/);
  });

  it("handles names with underscores", () => {
    const slug = generateEvaluatorSlug("my_custom_eval");
    expect(slug).toMatch(/^my-custom-eval-[a-z0-9]{5}$/);
  });

  it("handles names with ampersands", () => {
    const slug = generateEvaluatorSlug("Safety & Quality Check");
    // slugify with strict: true removes ampersands
    expect(slug).toMatch(/^safety-quality-check-[a-z0-9]{5}$/);
  });

  it("handles names with numbers", () => {
    const slug = generateEvaluatorSlug("Evaluator v3.0");
    // slugify with strict: true removes dots
    expect(slug).toMatch(/^evaluator-v30-[a-z0-9]{5}$/);
  });

  it("lowercases the slug", () => {
    const slug = generateEvaluatorSlug("UPPERCASE NAME");
    expect(slug).toMatch(/^uppercase-name-[a-z0-9]{5}$/);
  });

  it("trims whitespace from name", () => {
    const slug = generateEvaluatorSlug("  Trimmed Name  ");
    expect(slug).toMatch(/^trimmed-name-[a-z0-9]{5}$/);
  });

  /** @scenario Handle empty or whitespace-only names */
  it("throws error for empty name", () => {
    expect(() => generateEvaluatorSlug("")).toThrow(
      "Evaluator name cannot be empty",
    );
  });

  /** @scenario Handle empty or whitespace-only names */
  it("throws error for whitespace-only name", () => {
    expect(() => generateEvaluatorSlug("   ")).toThrow(
      "Evaluator name cannot be empty",
    );
  });

  /** @scenario Handle very long names */
  it("truncates very long names", () => {
    const longName = "A".repeat(100);
    const slug = generateEvaluatorSlug(longName);
    // Base should be truncated to 50 chars max, plus hyphen and 5-char suffix
    expect(slug.length).toBeLessThanOrEqual(56);
    // Should end with a 5-char nanoid suffix
    expect(slug).toMatch(/-[a-z0-9]{5}$/);
  });

  it("handles name that becomes empty after slugify", () => {
    // Name with only special chars that get removed
    const slug = generateEvaluatorSlug("!!!");
    // Should still return at least the nanoid suffix (5 chars)
    expect(slug).toHaveLength(5);
    expect(slug).toMatch(/^[a-z0-9]{5}$/);
  });

  it("does not end with hyphen before suffix", () => {
    // If truncation happens mid-word with hyphen at end
    const longName = "word-".repeat(20);
    const slug = generateEvaluatorSlug(longName);
    // Should not have double hyphen before suffix
    expect(slug).not.toContain("--");
  });

  it("includes 5-character nanoid suffix", () => {
    const slug = generateEvaluatorSlug("Test");
    // Suffix is 5 chars after last hyphen
    const parts = slug.split("-");
    expect(parts[parts.length - 1]).toHaveLength(5);
  });

  /** @scenario Slug uniqueness within project */
  it("generates unique slugs for same name", () => {
    const slug1 = generateEvaluatorSlug("Same Name");
    const slug2 = generateEvaluatorSlug("Same Name");

    // Base should be the same
    expect(slug1.startsWith("same-name-")).toBe(true);
    expect(slug2.startsWith("same-name-")).toBe(true);

    // But full slugs should be different due to nanoid
    expect(slug1).not.toBe(slug2);
  });

  /** @scenario Same name allowed in different projects */
  it("generates slugs that share the same base for the same name (project-independent)", () => {
    // generateEvaluatorSlug is project-agnostic — it's the *uniqueness* of the
    // resulting slug (per the random nanoid suffix) that lets two evaluators
    // with the same name coexist across projects without collision. Two calls
    // with identical input produce slugs with the same prefix but different
    // suffixes, so two projects creating "Same Name" each get a valid,
    // distinct slug.
    const slugProj1 = generateEvaluatorSlug("Exact Match");
    const slugProj2 = generateEvaluatorSlug("Exact Match");

    expect(slugProj1.startsWith("exact-match-")).toBe(true);
    expect(slugProj2.startsWith("exact-match-")).toBe(true);
    expect(slugProj1).not.toBe(slugProj2);
  });

  /** @scenario Handle unicode characters in name */
  it("removes or transliterates unicode characters in the name", () => {
    // slugify (strict mode) strips non-ASCII, leaving the latin parts.
    const slug = generateEvaluatorSlug("Säfety チェック");
    expect(slug).toMatch(/^[a-z0-9-]+-[a-z0-9]{5}$/);
  });

  /** @scenario Retry on unique constraint violation */
  it("produces a different slug on the next call when given the same name", () => {
    // The repository retries on unique-constraint violation by re-invoking
    // generateEvaluatorSlug (see EvaluatorRepository.create). This test
    // pins the contract that re-invocation yields a different slug, which
    // is what makes that retry path eventually converge.
    const first = generateEvaluatorSlug("Conflict");
    const second = generateEvaluatorSlug("Conflict");
    const third = generateEvaluatorSlug("Conflict");
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe("isValidEvaluatorSlug", () => {
  it("returns true for valid slug", () => {
    expect(isValidEvaluatorSlug("my-custom-evaluator-abc12")).toBe(true);
  });

  it("returns true for simple valid slug", () => {
    expect(isValidEvaluatorSlug("safety-abc12")).toBe(true);
  });

  it("returns true for slug with numbers", () => {
    expect(isValidEvaluatorSlug("evaluator-v3-abc12")).toBe(true);
  });

  it("returns true for slug that is just nanoid", () => {
    expect(isValidEvaluatorSlug("abc12")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidEvaluatorSlug("")).toBe(false);
  });

  it("returns false for slug with uppercase", () => {
    expect(isValidEvaluatorSlug("My-Evaluator-abc12")).toBe(false);
  });

  it("returns false for slug starting with hyphen", () => {
    expect(isValidEvaluatorSlug("-evaluator-abc12")).toBe(false);
  });

  it("returns false for slug ending with hyphen", () => {
    expect(isValidEvaluatorSlug("evaluator-abc12-")).toBe(false);
  });

  it("returns false for slug with consecutive hyphens", () => {
    expect(isValidEvaluatorSlug("my--evaluator-abc12")).toBe(false);
  });

  it("returns false for slug with special characters", () => {
    expect(isValidEvaluatorSlug("my_evaluator_abc12")).toBe(false);
    expect(isValidEvaluatorSlug("my.evaluator.abc12")).toBe(false);
  });

  it("returns false for slug too short", () => {
    expect(isValidEvaluatorSlug("abc")).toBe(false);
  });

  it("returns false for null or undefined", () => {
    expect(isValidEvaluatorSlug(null as any)).toBe(false);
    expect(isValidEvaluatorSlug(undefined as any)).toBe(false);
  });
});
