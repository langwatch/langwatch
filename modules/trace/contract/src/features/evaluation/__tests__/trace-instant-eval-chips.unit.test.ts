/**
 * How an Instant Eval is spelled in the filter language and keyed to the scope
 * it judged. Spec: specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import {
  hasInstantEvalChipUnderOr,
  isInstantEvalChipNegated,
  instantEvalChipsOf,
  instantEvalChipText,
  instantEvalRunKey,
  queryWithInstantEvalChipRetargeted,
  queryWithoutInstantEvalChip,
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
      { question: "is it rude", field: "eval", target: "threads", isUnjudgeable: false },
      { question: "is it wrong", field: "eval.llm", target: "llm_spans", isUnjudgeable: false },
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

describe("queryWithoutInstantEvalChip", () => {
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
    expect(queryWithoutInstantEvalChip({ queryText, field: "eval.llm", question: "annoyed" })).toBe(
      'eval:"annoyed"',
    );
    expect(queryWithoutInstantEvalChip({ queryText, field: "eval", question: "annoyed" })).toBe(
      'eval.llm:"annoyed"',
    );
  });
});

describe("queryWithInstantEvalChipRetargeted", () => {
  /** @scenario "A chip typed by hand starts its run on Enter" */
  it("re-spells a bare chip for its target in place, NOT and other terms kept", () => {
    expect(
      queryWithInstantEvalChipRetargeted({
        queryText: 'status:error AND NOT eval:"annoyed" AND eval:"other"',
        question: "annoyed",
        target: "traces",
        lensId: "conversations",
      }),
    ).toBe('status:error AND NOT eval.trace:"annoyed" AND eval:"other"');
  });

  /** @scenario "A chip typed by hand starts its run on Enter" */
  it("leaves a chip the lens already reads as its target as typed", () => {
    const queryText = 'NOT eval:"annoyed"';
    expect(
      queryWithInstantEvalChipRetargeted({
        queryText,
        question: "annoyed",
        target: "threads",
        lensId: "conversations",
      }),
    ).toBe(queryText);
  });
});

describe("hasInstantEvalChipUnderOr", () => {
  /** @scenario "A chip typed by hand starts its run on Enter" */
  it("finds the named chip below an OR, at any depth, and only there", () => {
    const under = (queryText: string, field = "eval", question = "annoyed") =>
      hasInstantEvalChipUnderOr({ queryText, field, question });
    expect(under('status:error OR eval:"annoyed"')).toBe(true);
    expect(under('a:1 OR (b:2 AND NOT eval.llm:"annoyed")', "eval.llm")).toBe(true);
    expect(under('status:error AND NOT eval:"annoyed"')).toBe(false);
    expect(under("status:error OR model:x")).toBe(false);
  });

  /** @scenario "A chip typed by hand starts its run on Enter" */
  it("ignores another eval chip under an OR", () => {
    const queryText = 'NOT eval:"b" AND (status:error OR eval:"a")';
    expect(hasInstantEvalChipUnderOr({ queryText, field: "eval", question: "b" })).toBe(false);
    expect(hasInstantEvalChipUnderOr({ queryText, field: "eval", question: "a" })).toBe(true);
  });

  /** @scenario "A chip typed by hand starts its run on Enter" */
  it("counts a NOT over a group with other terms as an OR, but not a NOT on the chip alone", () => {
    const under = (queryText: string) =>
      hasInstantEvalChipUnderOr({ queryText, field: "eval", question: "the user" });
    expect(under('NOT (eval:"the user" AND status:error)')).toBe(true);
    expect(under('NOT (status:error AND (eval:"the  user"))')).toBe(true);
    expect(under('status:error AND NOT (eval:"the user")')).toBe(false);
  });
});

describe("instantEvalChipsOf isUnjudgeable", () => {
  // Throws on a question the query lacks, so a `false` is never vacuous.
  const refused = (queryText: string, question = "q") => {
    const chips = instantEvalChipsOf({ queryText, lensId: undefined }).filter(
      (chip) => chip.question === question,
    );
    if (chips.length === 0) throw new Error(`no chip "${question}" in ${queryText}`);
    return chips.some((chip) => chip.isUnjudgeable);
  };

  /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
  it("refuses a NOT on the chip under an OR, and a NOT over a group holding it", () => {
    expect(refused('NOT eval:"q" OR status:error')).toBe(true);
    expect(refused('NOT (eval:"q" AND status:error)')).toBe(true);
    expect(refused('NOT (eval:"q" OR status:error)')).toBe(true);
  });

  /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
  it("leaves a NOT on the chip beside AND, an OR without NOT, and another chip alone", () => {
    expect(refused('status:error AND NOT eval:"q"')).toBe(false);
    expect(refused('status:error OR eval:"q"')).toBe(false);
    expect(refused('NOT eval:"b" AND (status:error OR eval:"q")')).toBe(false);
    expect(refused('(NOT eval:"b" OR status:error) AND eval:"q"')).toBe(false);
    expect(refused('(NOT eval:"b" OR status:error) AND eval:"q"', "b")).toBe(true);
  });
});

describe("isInstantEvalChipNegated", () => {
  /** @scenario "A pending chip under NOT is not judged yet" */
  it("finds a NOT above the named chip at any depth, and only that chip", () => {
    const negated = (queryText: string, question = "q") =>
      isInstantEvalChipNegated({ queryText, field: "eval", question });
    expect(negated('NOT eval:"q"')).toBe(true);
    expect(negated('status:error AND NOT (eval:"q")')).toBe(true);
    expect(negated('eval:"q" AND NOT status:error')).toBe(false);
    expect(negated('NOT eval:"b" AND eval:"q"')).toBe(false);
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
      {
        question: "is it rude",
        field: "eval",
        target: "traces",
        isUnjudgeable: false,
        key,
        runId: null,
      },
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

  /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
  it("sends no run for a chip a NOT reaches across an OR, even when one is registered", () => {
    const queryText = 'NOT eval:"is it rude" OR status:error';
    const otherQuery = queryWithoutInstantEvalChips(queryText);
    const key = instantEvalRunKey({ question: "is it rude", target: "traces", otherQuery, window });

    const resolved = resolveInstantEvalChips({
      queryText,
      lensId: undefined,
      window,
      runsByKey: { [key]: "run-1" },
    });

    expect(resolved.evalRuns).toBeUndefined();
    expect(resolved.chips).toEqual([
      {
        question: "is it rude",
        field: "eval",
        target: "traces",
        isUnjudgeable: true,
        key,
        runId: null,
      },
    ]);
  });

  /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
  it("keeps the run for a sibling with the same question that no NOT reaches", () => {
    const queryText = '(NOT eval:"is it rude" OR status:error) AND eval:"is it rude"';
    const otherQuery = queryWithoutInstantEvalChips(queryText);
    const key = instantEvalRunKey({ question: "is it rude", target: "traces", otherQuery, window });

    const resolved = resolveInstantEvalChips({
      queryText,
      lensId: undefined,
      window,
      runsByKey: { [key]: "run-1" },
    });

    expect(resolved.chips.map((chip) => [chip.isUnjudgeable, chip.runId])).toEqual([
      [true, null],
      [false, "run-1"],
    ]);
    expect(resolved.evalRuns).toEqual({
      [key]: { question: "is it rude", target: "traces", runId: "run-1" },
    });
  });
});
