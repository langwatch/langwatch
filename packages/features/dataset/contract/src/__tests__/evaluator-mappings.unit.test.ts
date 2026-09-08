import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAPPINGS,
  mappingsReadEvaluationsSource,
  migrateLegacyMappings,
} from "../evaluator-mappings.ts";

describe("evaluator input mappings", () => {
  it("keeps the default contexts and expected output sources", () => {
    expect(DEFAULT_MAPPINGS.mapping.contexts).toEqual({ source: "contexts" });
    expect(DEFAULT_MAPPINGS.mapping.expected_output).toEqual({
      source: "metadata",
      key: "expected_output",
    });
    expect(mappingsReadEvaluationsSource(DEFAULT_MAPPINGS)).toBe(false);
  });

  it("converts legacy trace and metadata sources without losing field names", () => {
    expect(
      migrateLegacyMappings({ question: "trace.input", answer: "metadata.expected_output" }),
    ).toEqual({
      mapping: {
        question: { source: "input" },
        answer: { source: "metadata", key: "expected_output" },
      },
      expansions: [],
    });
  });

  it("requests prior evaluation data only when a mapping reads it", () => {
    expect(mappingsReadEvaluationsSource(null)).toBe(false);
    expect(mappingsReadEvaluationsSource({ mapping: {}, expansions: [] })).toBe(false);
    expect(
      mappingsReadEvaluationsSource({
        mapping: { score: { source: "evaluations", key: "quality" } },
        expansions: [],
      }),
    ).toBe(true);
  });
});
