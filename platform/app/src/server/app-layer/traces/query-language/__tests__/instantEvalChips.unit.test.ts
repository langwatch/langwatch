/**
 * The `eval` chip's spelling and the key its run is registered under.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A run is keyed to the
 * scope it judged").
 */
import { describe, expect, it } from "vitest";
import {
  instantEvalChipsOf,
  instantEvalChipText,
  instantEvalRunKey,
  instantEvalTargetForLens,
  queryWithoutInstantEvalChip,
  queryWithoutInstantEvalChips,
  resolveInstantEvalChips,
} from "../instantEvalChips";

const scope = {
  question: "the user is annoyed",
  target: "traces" as const,
  otherQuery: "service:api",
  window: { from: 1_000, to: 2_000 },
};

describe("instantEvalRunKey", () => {
  describe("given the same question over the same scope", () => {
    /** @scenario "The same question over the same scope shares one key" */
    it("computes the same key twice", () => {
      expect(instantEvalRunKey(scope)).toBe(instantEvalRunKey({ ...scope }));
      expect(instantEvalRunKey(scope)).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("when the range, the target or the other chips change", () => {
    /** @scenario "A change of range, target or other chips invalidates the key" */
    it("computes a different key for each change", () => {
      const base = instantEvalRunKey(scope);
      expect(
        instantEvalRunKey({ ...scope, window: { from: 1_000, to: 3_000 } }),
      ).not.toBe(base);
      expect(instantEvalRunKey({ ...scope, target: "threads" })).not.toBe(base);
      expect(
        instantEvalRunKey({ ...scope, otherQuery: "service:worker" }),
      ).not.toBe(base);
      expect(
        instantEvalRunKey({ ...scope, question: "the user is happy" }),
      ).not.toBe(base);
    });
  });

  describe("when the window is a rolling preset", () => {
    /** @scenario "A rolling preset does not re-run every tick" */
    it("keys by the preset id, so rolled bounds keep the key", () => {
      const first = instantEvalRunKey({
        ...scope,
        window: { from: 1_000, to: 2_000, presetId: "7d" },
      });
      const rolled = instantEvalRunKey({
        ...scope,
        window: { from: 1_500, to: 2_500, presetId: "7d" },
      });
      expect(rolled).toBe(first);
      expect(
        instantEvalRunKey({
          ...scope,
          window: { from: 1_000, to: 2_000, presetId: "30d" },
        }),
      ).not.toBe(first);
    });
  });
});

describe("instantEvalChipsOf", () => {
  describe("given a query with an eval chip on the Conversations lens", () => {
    it("reads the bare chip as a threads chip and a forcing chip as written", () => {
      const chips = instantEvalChipsOf({
        queryText: 'service:api AND eval:"annoyed" AND eval.llm:"wrong"',
        lensId: "conversations",
      });
      expect(chips).toEqual([
        { question: "annoyed", field: "eval", target: "threads" },
        { question: "wrong", field: "eval.llm", target: "llm_spans" },
      ]);
      expect(instantEvalTargetForLens("all-traces")).toBe("traces");
    });
  });

  describe("given a query with eval chips", () => {
    it("leaves the other chips when the eval chips are taken out", () => {
      expect(
        queryWithoutInstantEvalChips(
          'service:api AND eval:"annoyed" AND status:error',
        ),
      ).toBe("service:api AND status:error");
      expect(queryWithoutInstantEvalChips('eval:"annoyed"')).toBe("");
    });

    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("takes one chip out and keeps the other eval chips beside the filter", () => {
      expect(
        queryWithoutInstantEvalChip({
          queryText: 'service:api AND eval:"annoyed" AND eval.llm:"wrong"',
          field: "eval",
          question: "annoyed",
        }),
      ).toBe('service:api AND eval.llm:"wrong"');
      expect(
        queryWithoutInstantEvalChip({
          queryText: 'eval:"annoyed"',
          field: "eval",
          question: "annoyed",
        }),
      ).toBe("");
    });

    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("keeps the same question under another target, since that is another chip", () => {
      const queryText = 'eval.llm:"annoyed" AND eval:"annoyed"';
      expect(
        queryWithoutInstantEvalChip({
          queryText,
          field: "eval.llm",
          question: "annoyed",
        }),
      ).toBe('eval:"annoyed"');
      expect(
        queryWithoutInstantEvalChip({
          queryText,
          field: "eval",
          question: "annoyed",
        }),
      ).toBe('eval.llm:"annoyed"');
    });
  });
});

describe("instantEvalChipText", () => {
  /** @scenario "A target that differs from the lens default is written on the chip" */
  it("writes the bare field for the lens default and the forcing field otherwise", () => {
    expect(
      instantEvalChipText({
        question: "the user is annoyed",
        target: "traces",
        lensId: "all-traces",
      }),
    ).toBe('eval:"the user is annoyed"');
    expect(
      instantEvalChipText({
        question: "the user is annoyed",
        target: "traces",
        lensId: "conversations",
      }),
    ).toBe('eval.trace:"the user is annoyed"');
    expect(
      instantEvalChipText({
        question: "wrong",
        target: "llm_spans",
        lensId: "all-traces",
      }),
    ).toBe('eval.llm:"wrong"');
  });
});

describe("resolveInstantEvalChips", () => {
  describe("given a chip with a run under its key", () => {
    /** @scenario "A registered run is sent with every read the Explorer makes" */
    it("answers the wire map with the question, the target and the run id", () => {
      const key = instantEvalRunKey(scope);
      const resolved = resolveInstantEvalChips({
        queryText: 'service:api AND eval:"the user is annoyed"',
        lensId: "all-traces",
        window: scope.window,
        runsByKey: { [key]: "run-1" },
      });
      expect(resolved.evalRuns).toEqual({
        [key]: {
          question: "the user is annoyed",
          target: "traces",
          runId: "run-1",
        },
      });
      expect(resolved.chips[0]).toMatchObject({ key, runId: "run-1" });
    });
  });

  describe("given a chip with no run under its key", () => {
    /** @scenario "A chip with no registered run is pending" */
    it("reports the chip pending and sends no entry", () => {
      const resolved = resolveInstantEvalChips({
        queryText: 'eval:"the user is annoyed"',
        lensId: "all-traces",
        window: scope.window,
        runsByKey: {},
      });
      expect(resolved.evalRuns).toBeUndefined();
      expect(resolved.chips).toHaveLength(1);
      expect(resolved.chips[0]?.runId).toBeNull();
    });
  });
});
