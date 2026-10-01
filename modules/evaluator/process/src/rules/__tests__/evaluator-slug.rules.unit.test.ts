/**
 * @vitest-environment node
 * @see specs/evaluators/evaluator-management.feature
 */
import { describe, expect, it } from "vitest";

import { generateEvaluatorSlug } from "../evaluator-slug.rules.ts";

describe("generateEvaluatorSlug", () => {
  /** @scenario "Generate slug from evaluator name on creation" */
  it("slugifies the name and appends a five-character suffix", () => {
    expect(generateEvaluatorSlug("My Custom Evaluator")).toMatch(
      /^my-custom-evaluator-[a-z0-9]{5}$/,
    );
  });

  /** @scenario "Slug uniqueness within project" */
  it("gives the same name a different slug each time", () => {
    const slugs = new Set(Array.from({ length: 20 }, () => generateEvaluatorSlug("ev")));

    expect(slugs.size).toBeGreaterThan(1);
  });

  /** @scenario "Handle special characters in name" */
  it("drops punctuation and transliterates accents", () => {
    expect(generateEvaluatorSlug("LLM Judge (v2.0) - Beta!")).toMatch(
      /^llm-judge-v20-beta-[a-z0-9]{5}$/,
    );
    expect(generateEvaluatorSlug("Säfety Check")).toMatch(/^safety-check-[a-z0-9]{5}$/);
  });

  it("falls back to the suffix alone for a name with no slug characters", () => {
    expect(generateEvaluatorSlug("!!!")).toMatch(/^[a-z0-9]{5}$/);
  });

  /** @scenario "Handle very long names" */
  it("truncates a long name without leaving a trailing hyphen", () => {
    const slug = generateEvaluatorSlug(`${"a".repeat(49)} b`);

    expect(slug).toMatch(/^a{49}-[a-z0-9]{5}$/);
  });
});
