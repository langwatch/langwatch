import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAPPINGS,
  defaultEvaluatorMappings,
  hasMappingEntries,
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

  describe("when no mapping was saved", () => {
    /** @scenario "An LLM judge with no saved mapping reads the whole trace" */
    it("gives a whole-trace judge the AI-readable trace and the thread's steps view", () => {
      expect(defaultEvaluatorMappings({ level: "trace", readsWholeTrace: true }).mapping).toEqual({
        ...DEFAULT_MAPPINGS.mapping,
        input: { source: "formatted_trace" },
      });
      expect(defaultEvaluatorMappings({ level: "thread", readsWholeTrace: true }).mapping).toEqual({
        input: { type: "thread", source: "formatted_traces" },
      });
    });

    it("keeps other evaluators on the trace's own fields and the thread's traces", () => {
      expect(defaultEvaluatorMappings({ level: "trace", readsWholeTrace: false })).toBe(
        DEFAULT_MAPPINGS,
      );
      expect(defaultEvaluatorMappings({ level: "thread", readsWholeTrace: false }).mapping).toEqual(
        { input: { type: "thread", source: "traces" } },
      );
    });

    it("reads an empty stored mapping as no mapping", () => {
      expect(hasMappingEntries(null)).toBe(false);
      expect(hasMappingEntries({ mapping: {}, expansions: [] })).toBe(false);
      expect(hasMappingEntries(DEFAULT_MAPPINGS)).toBe(true);
    });
  });
});
