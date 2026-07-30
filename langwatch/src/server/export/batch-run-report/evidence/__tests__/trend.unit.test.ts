import { describe, expect, it } from "vitest";
import type { CriterionOutcome, TrendClassification } from "../../report.types";
import { classifyTrend, type TrendHistoryEntry } from "../trend";

/**
 * What a criterion's history says about it.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

function historyOf(outcomes: CriterionOutcome[]): TrendHistoryEntry[] {
  return outcomes.map((outcome, index) => ({
    batchRunId: `batch_${index}`,
    outcome,
  }));
}

function classify(outcomes: CriterionOutcome[]): TrendClassification {
  return classifyTrend({ history: historyOf(outcomes) }).classification;
}

describe("classifyTrend()", () => {
  describe("given each shape of history", () => {
    const cases: {
      name: string;
      outcomes: CriterionOutcome[];
      classification: TrendClassification;
    }[] = [
      { name: "one passing run", outcomes: ["met"], classification: "new" },
      { name: "one failing run", outcomes: ["unmet"], classification: "new" },
      {
        name: "passing then failing",
        outcomes: ["met", "unmet"],
        classification: "regression",
      },
      {
        name: "failing then passing",
        outcomes: ["unmet", "met"],
        classification: "fixed",
      },
      {
        name: "failing every time",
        outcomes: ["unmet", "unmet", "unmet"],
        classification: "long_standing",
      },
      {
        name: "passing every time",
        outcomes: ["met", "met", "met"],
        classification: "stable_pass",
      },
      {
        name: "failing twice in a row",
        outcomes: ["unmet", "unmet"],
        classification: "stable_fail",
      },
      {
        name: "alternating",
        outcomes: ["met", "unmet", "met", "unmet"],
        classification: "unreliable",
      },
    ];

    it.each(cases)("classifies $name as $classification", (testCase) => {
      expect(classify(testCase.outcomes)).toBe(testCase.classification);
    });
  });
});

describe("classifyTrend() verdicts a reader acts on", () => {
  /** @scenario A criterion that used to pass and now fails is called a regression */
  it("calls a criterion that passed last time and fails now a regression", () => {
    expect(classify(["met", "met", "unmet"])).toBe("regression");
  });

  /** @scenario A criterion that used to fail and now passes is called fixed */
  it("calls a criterion that failed last time and passes now fixed", () => {
    expect(classify(["unmet", "unmet", "met"])).toBe("fixed");
  });

  /** @scenario A criterion that has failed every time is called long-standing */
  it("calls a criterion that has never once passed long-standing", () => {
    expect(classify(["unmet", "unmet", "unmet", "unmet"])).toBe(
      "long_standing",
    );
  });

  /** @scenario A criterion that has failed every time is called long-standing */
  it("withholds long-standing from a criterion that passed at some point", () => {
    expect(classify(["met", "unmet", "unmet", "unmet"])).toBe("stable_fail");
  });

  /** @scenario A criterion never seen before is not called a regression */
  it("calls a criterion seen for the first time new", () => {
    expect(classify(["unmet"])).toBe("new");
  });

  it("calls a criterion with no appearances at all new", () => {
    expect(classify([])).toBe("new");
  });
});

describe("classifyTrend() when a criterion keeps flipping", () => {
  /** @scenario A criterion that keeps changing its mind is called unreliable */
  it("reports it as unreliable rather than as a regression", () => {
    expect(classify(["met", "unmet", "met", "unmet"])).toBe("unreliable");
  });

  /** @scenario A criterion that keeps changing its mind is called unreliable */
  it("reports it as unreliable rather than as fixed", () => {
    expect(classify(["unmet", "met", "unmet", "met"])).toBe("unreliable");
  });

  it("still calls a single direction change a regression", () => {
    expect(classify(["met", "met", "met", "unmet"])).toBe("regression");
  });
});

describe("classifyTrend() when a criterion was absent from some runs", () => {
  it("skips the absences rather than counting them as flips", () => {
    expect(classify(["met", "absent", "met", "absent", "met"])).toBe(
      "stable_pass",
    );
  });

  it("compares against the last run the criterion actually appeared in", () => {
    expect(classify(["met", "absent", "absent", "unmet"])).toBe("regression");
  });

  it("calls a criterion that only ever appeared once new", () => {
    expect(classify(["absent", "absent", "unmet"])).toBe("new");
  });

  it("returns no streak when the criterion never appeared", () => {
    const result = classifyTrend({ history: historyOf(["absent", "absent"]) });
    expect(result).toEqual({ classification: "new", streakBatches: 0 });
  });
});

describe("classifyTrend() streak counting", () => {
  function streakOf(outcomes: CriterionOutcome[]): number {
    return classifyTrend({ history: historyOf(outcomes) }).streakBatches;
  }

  it("counts only the trailing run of identical outcomes", () => {
    expect(streakOf(["unmet", "met", "met", "met"])).toBe(3);
  });

  it("stops at the first differing outcome", () => {
    expect(streakOf(["met", "met", "unmet"])).toBe(1);
  });

  it("ignores absences when counting", () => {
    expect(streakOf(["met", "absent", "met"])).toBe(2);
  });

  it("counts every appearance when the outcome never changed", () => {
    expect(streakOf(["unmet", "unmet", "unmet"])).toBe(3);
  });
});
