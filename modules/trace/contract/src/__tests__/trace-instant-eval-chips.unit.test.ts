/**
 * How an Instant Eval is spelled in the filter language and keyed to the scope
 * it judged. Spec: specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import {
  instantEvalChipsOf,
  instantEvalChipText,
  instantEvalRunKey,
  queryWithoutInstantEvalChips,
  resolveInstantEvalChips,
} from "../trace-instant-eval-chips.ts";

const window = { from: 1_700_000_000_000, to: 1_700_003_600_000 };
const scope = {
  question: "the user is annoyed",
  target: "traces",
  otherQuery: 'status:error AND model:"gpt-4"',
  window,
} as const;

describe("instantEvalRunKey", () => {
  /** @scenario "The same question over the same scope shares one key" */
  it("is the same key for the same question over the same scope", () => {
    expect(instantEvalRunKey(scope)).toBe(instantEvalRunKey({ ...scope }));
  });

  /** @scenario "A change of range, target or other chips invalidates the key" */
  it("changes when the range, the target or another chip changes", () => {
    const original = instantEvalRunKey(scope);

    expect(instantEvalRunKey({ ...scope, window: { ...window, to: window.to + 1 } })).not.toBe(
      original,
    );
    expect(instantEvalRunKey({ ...scope, target: "threads" })).not.toBe(original);
    expect(instantEvalRunKey({ ...scope, otherQuery: "status:error" })).not.toBe(original);
  });

  /** @scenario "A rolling preset does not re-run every tick" */
  it("holds still while a preset's bounds roll forward", () => {
    const preset = { ...scope, window: { ...window, presetId: "last-7-days" } };
    const rolled = {
      ...preset,
      window: { from: window.from + 60_000, to: window.to + 60_000, presetId: "last-7-days" },
    };

    expect(instantEvalRunKey(rolled)).toBe(instantEvalRunKey(preset));
  });
});

describe("instantEvalChipText", () => {
  /** @scenario "A chip forcing a unit is spelled by that unit's field" */
  it("spells the forcing field when the target is not the lens's, and the bare field when it is", () => {
    expect(
      instantEvalChipText({
        question: "the user is annoyed",
        target: "threads",
        lensId: undefined,
      }),
    ).toBe('eval.conversation:"the user is annoyed"');
    expect(
      instantEvalChipText({ question: "the user is annoyed", target: "traces", lensId: undefined }),
    ).toBe('eval:"the user is annoyed"');
    expect(
      instantEvalChipText({
        question: "the user is annoyed",
        target: "threads",
        lensId: "conversations",
      }),
    ).toBe('eval:"the user is annoyed"');
  });

  it("escapes a question carrying a quote", () => {
    expect(
      instantEvalChipText({ question: 'the user said "no"', target: "traces", lensId: undefined }),
    ).toBe('eval:"the user said \\"no\\""');
  });
});

describe("instantEvalChipsOf", () => {
  it("resolves the bare field against the lens and a forcing field against itself", () => {
    const chips = instantEvalChipsOf({
      queryText: 'eval:"is it rude" AND eval.llm:"is it wrong"',
      lensId: "conversations",
    });

    expect(chips).toEqual([
      { question: "is it rude", field: "eval", target: "threads" },
      { question: "is it wrong", field: "eval.llm", target: "llm_spans" },
    ]);
  });

  it("reads no chip out of an unparsable query", () => {
    expect(instantEvalChipsOf({ queryText: 'eval:"unclosed', lensId: undefined })).toEqual([]);
  });
});

describe("queryWithoutInstantEvalChips", () => {
  it("leaves the other chips of the query behind", () => {
    expect(queryWithoutInstantEvalChips('status:error AND eval:"is it rude"')).toBe("status:error");
  });

  it("is empty when the query is nothing but eval chips", () => {
    expect(queryWithoutInstantEvalChips('eval:"is it rude"')).toBe("");
  });
});

describe("resolveInstantEvalChips", () => {
  it("sends only the chips a run is registered for, and none at all when there are none", () => {
    const queryText = 'status:error AND eval:"is it rude"';
    const otherQuery = queryWithoutInstantEvalChips(queryText);
    const key = instantEvalRunKey({ question: "is it rude", target: "traces", otherQuery, window });

    const pending = resolveInstantEvalChips({
      queryText,
      lensId: undefined,
      window,
      runsByKey: {},
    });
    expect(pending.evalRuns).toBeUndefined();
    expect(pending.chips).toEqual([
      { question: "is it rude", field: "eval", target: "traces", key, runId: null },
    ]);

    const registered = resolveInstantEvalChips({
      queryText,
      lensId: undefined,
      window,
      runsByKey: { [key]: "run-1" },
    });
    expect(registered.evalRuns).toEqual({
      [key]: { question: "is it rude", target: "traces", runId: "run-1" },
    });
  });
});
