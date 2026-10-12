/** @see modules/experiment/specs/experiment-list-page.feature */
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type { ListMetric } from "../experiment-list-metrics.ts";
import {
  describeGap,
  gapOf,
  hasTooFewItems,
  isTied,
  median,
  rankTargets,
  targetResultsOf,
  targetValue,
  tieNoteOf,
} from "../experiment-list-targets.ts";

const metric: ListMetric = { key: "c", evaluatorId: "c", label: "correct", kind: "passRate" };

/** n items for one target, `passed` of them passing. */
function itemsFor({ targetId, n, passed }: { targetId: string; n: number; passed: number }) {
  return {
    dataset: Array.from({ length: n }, (_, index) => ({
      index,
      targetId,
      entry: {},
      cost: 0.01,
      duration: 100 + index,
      error: index === 0 && targetId === "t2" ? "boom" : null,
    })),
    evaluations: Array.from({ length: n }, (_, index) => ({
      evaluator: "c",
      targetId,
      status: "processed" as const,
      index,
      passed: index < passed,
    })),
  };
}

function runOf(
  specs: { id: string; model?: string; n: number; passed: number }[],
): ExperimentRunWithItems {
  const parts = specs.map((spec) =>
    itemsFor({ targetId: spec.id, n: spec.n, passed: spec.passed }),
  );
  return {
    experimentId: "e",
    runId: "r",
    projectId: "p",
    targets: specs.map((spec) => ({
      id: spec.id,
      name: `name-${spec.id}`,
      type: "prompt",
      model: spec.model,
    })),
    dataset: parts.flatMap((part) => part.dataset),
    evaluations: parts.flatMap((part) => part.evaluations),
    timestamps: { createdAt: 1, updatedAt: 1 },
    completeness: {
      complete: true,
      dataset: { received: 0, expected: null },
      evaluations: { received: 0, expected: null },
    },
  };
}

describe("given a run's items", () => {
  const results = targetResultsOf(
    runOf([
      { id: "t1", model: "openai/gpt-5", n: 100, passed: 90 },
      { id: "t2", model: "anthropic/claude-x", n: 100, passed: 70 },
    ]),
  );

  it("summarises each target on its own rows", () => {
    expect(results.map((r) => [r.label, r.items, targetValue(r, metric)])).toEqual([
      ["gpt-5", 100, 90],
      ["claude-x", 100, 70],
    ]);
  });

  it("keeps the full model id for the provider mark", () => {
    expect(results[0]?.model).toBe("openai/gpt-5");
  });

  it("counts failed answers and keeps the first error", () => {
    expect(results[1]).toMatchObject({ errors: 1, firstError: "boom" });
  });

  it("adds cost and takes the median latency", () => {
    expect(results[0]?.costUsd).toBeCloseTo(1);
    expect(results[0]?.p50Ms).toBeCloseTo(149.5);
  });

  it("tells two targets on one model apart by the target name", () => {
    const same = targetResultsOf(
      runOf([
        { id: "a", model: "openai/gpt-5", n: 1, passed: 1 },
        { id: "b", model: "openai/gpt-5", n: 1, passed: 1 },
      ]),
    );
    expect(same.map((r) => r.label)).toEqual(["gpt-5 · name-a", "gpt-5 · name-b"]);
  });

  it("gives rows that name no target to the run's only target", () => {
    const run = runOf([{ id: "only", n: 4, passed: 2 }]);
    const [target] = targetResultsOf({
      ...run,
      dataset: run.dataset.map((row) => ({ ...row, targetId: null })),
      evaluations: run.evaluations.map((e) => ({ ...e, targetId: null })),
    });
    expect([target?.items, target && targetValue(target, metric)]).toEqual([4, 50]);
  });
});

describe("given two pass rates", () => {
  const pair = (a: number, b: number, n: number) =>
    targetResultsOf(
      runOf([
        { id: "t1", n, passed: a },
        { id: "t2", n, passed: b },
      ]),
    );

  it("calls a 0.2 pt lead on 1,000 items a tie", () => {
    const [a, b] = pair(832, 830, 1000);
    expect(isTied({ a: a!, b: b!, metric })).toBe(true);
  });

  /** @scenario Equal rates at 0% or 100% are a tie */
  it("calls two identical rates tied at the extremes, where the standard error is zero", () => {
    for (const [passed, n] of [
      [100, 100],
      [0, 100],
    ] as const) {
      const [a, b] = pair(passed, passed, n);
      expect(isTied({ a: a!, b: b!, metric })).toBe(true);
    }
  });

  it("does not tie 100% with 0%", () => {
    const [a, b] = pair(100, 0, 100);
    expect(isTied({ a: a!, b: b!, metric })).toBe(false);
  });

  /** @scenario Too few items are never crowned */
  it("calls no winner on 5/5 against 0/5 or 1/1 against 0/1: too few items", () => {
    for (const [a, b, n] of [
      [5, 0, 5],
      [1, 0, 1],
    ] as const) {
      const [first, second] = pair(a, b, n);
      expect(isTied({ a: first!, b: second!, metric })).toBe(true);
      expect(hasTooFewItems({ a: first!, b: second!, metric })).toBe(true);
      const ranked = rankTargets({ targets: [first!, second!], metric });
      expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
    }
  });

  it("calls a 20 pt lead on 100 items real", () => {
    const [a, b] = pair(90, 70, 100);
    expect(isTied({ a: a!, b: b!, metric })).toBe(false);
  });
});

describe("given pass rates over fewer decided items than rows", () => {
  /** 1,000 rows each, but only the first `decided` rows have a verdict. */
  const decidedOf = ({ passed, decided }: { passed: number; decided: number }) => {
    const [target] = targetResultsOf(runOf([{ id: "t1", n: 1000, passed: 1000 }]));
    const full = runOf([{ id: "t1", n: 1000, passed: 0 }]);
    return {
      ...target!,
      evaluators: { c: { passed, failed: decided - passed, scores: [] } },
      items: full.dataset.length,
    };
  };

  /** @scenario A gap is judged over the items that were decided */
  it("sizes the interval by decided items, not by rows", () => {
    // 30/40 against 22/40: a 20 pt gap that is noise at 40 decided items, real at 1,000
    const a = decidedOf({ passed: 30, decided: 40 });
    const b = decidedOf({ passed: 22, decided: 40 });
    expect(isTied({ a, b, metric })).toBe(true);
    const wide = (target: typeof a, passed: number) => ({
      ...target,
      evaluators: { c: { passed, failed: 1000 - passed, scores: [] } },
    });
    expect(isTied({ a: wide(a, 750), b: wide(b, 550), metric })).toBe(false);
  });
});

describe("given a leader with enough items and a target with too few", () => {
  /** @scenario Too few items are never crowned */
  it("does not rank the thin target beside the leader", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 100, passed: 90 },
        { id: "t2", n: 5, passed: 4 },
      ]),
    );
    const ranked = rankTargets({ targets, metric });
    expect(ranked.map((entry) => [entry.target.id, entry.rank])).toEqual([
      ["t1", 1],
      ["t2", 2],
    ]);
  });
});

describe("given a run with failed evaluations", () => {
  it("leaves status error out of the tallies", () => {
    const run = runOf([{ id: "t1", n: 4, passed: 2 }]);
    const [target] = targetResultsOf({
      ...run,
      evaluations: run.evaluations.map((e, i) =>
        i === 0 ? { ...e, status: "error" as const } : e,
      ),
    });
    // item 0 passed but errored: 1 pass, 2 fails, not 2 and 2
    expect([target?.evaluators.c?.passed, target?.evaluators.c?.failed]).toEqual([1, 2]);
  });
});

describe("given several targets", () => {
  /** @scenario A tie with the leader is never crowned */
  it("ranks a pass rate best first, tied targets sharing rank 1", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 1000, passed: 832 },
        { id: "t2", n: 1000, passed: 830 },
        { id: "t3", n: 1000, passed: 600 },
      ]),
    );
    expect(rankTargets({ targets, metric }).map((r) => [r.target.id, r.rank])).toEqual([
      ["t1", 1],
      ["t2", 1],
      ["t3", 3],
    ]);
  });

  /** @scenario A score is never ranked */
  it("only orders an average score, with no rank", () => {
    const targets = targetResultsOf(runOf([{ id: "t1", n: 2, passed: 1 }]));
    const score: ListMetric = { ...metric, kind: "score" };
    expect(rankTargets({ targets, metric: score })).toEqual([]);
  });

  it("says a gap in points, ahead or behind", () => {
    expect(describeGap(2.14)).toBe("2.1 pt ahead");
    expect(describeGap(-0.46)).toBe("0.5 pt behind");
  });

  /** @scenario Equal rates at 0% or 100% are a tie */
  it("says tied for no gap", () => {
    expect(describeGap(0)).toBe("tied");
  });

  it("has no median of nothing", () => {
    expect(median([])).toBeUndefined();
  });
});

describe("given three targets inside each other's interval", () => {
  /** @scenario A tie is said once above the target table */
  it("says no clear winner once, naming how many are within noise", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 1000, passed: 838 },
        { id: "t2", n: 1000, passed: 836 },
        { id: "t3", n: 1000, passed: 831 },
      ]),
    );
    const ranked = rankTargets({ targets, metric });
    expect(tieNoteOf({ ranked, tooFew: false })).toEqual({
      lead: "No clear winner:",
      rest: "all 3 within noise (gaps inside the 95% interval).",
    });
  });

  it("names the top few when a lower target is clearly behind", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 1000, passed: 838 },
        { id: "t2", n: 1000, passed: 836 },
        { id: "t3", n: 1000, passed: 600 },
      ]),
    );
    const note = tieNoteOf({ ranked: rankTargets({ targets, metric }), tooFew: false });
    expect(note?.rest).toContain("the top 2");
  });

  it("says too few items instead when a target has under ten decided items", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 5, passed: 5 },
        { id: "t2", n: 5, passed: 0 },
      ]),
    );
    const note = tieNoteOf({ ranked: rankTargets({ targets, metric }), tooFew: true });
    expect(note?.lead).toBe("Too few items to call a winner:");
  });

  it("says nothing with a single leader", () => {
    const targets = targetResultsOf(
      runOf([
        { id: "t1", n: 100, passed: 90 },
        { id: "t2", n: 100, passed: 50 },
      ]),
    );
    expect(tieNoteOf({ ranked: rankTargets({ targets, metric }), tooFew: false })).toBeUndefined();
  });
});

describe("given the gap between two targets", () => {
  /** @scenario A target is compared with the top target in words */
  it("reads points behind for a clear gap and nothing inside the noise", () => {
    const [top, behind, near] = targetResultsOf(
      runOf([
        { id: "t1", n: 1000, passed: 838 },
        { id: "t2", n: 1000, passed: 700 },
        { id: "t3", n: 1000, passed: 836 },
      ]),
    );
    expect(gapOf({ a: behind!, b: top!, metric, delta: -13.8 })).toEqual({
      text: "13.8 pt behind",
      ahead: false,
    });
    expect(gapOf({ a: near!, b: top!, metric, delta: -0.2 })).toBeUndefined();
  });
});
