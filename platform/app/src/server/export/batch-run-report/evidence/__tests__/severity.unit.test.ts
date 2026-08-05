import { describe, expect, it } from "vitest";
import type {
  FailureSignature,
  Severity,
  TrendClassification,
} from "../../report.types";
import { bySeverityDescending, computeSeverityPrior } from "../severity";

/**
 * The deterministic prior for how much a failure mode matters.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const SETTLED_RUNS = 10;

function signatureOf(
  overrides: Partial<FailureSignature> = {},
): FailureSignature {
  return {
    signatureId: "s_one",
    kind: "judged",
    unmetCriterionIds: [],
    errorShape: null,
    errorExample: null,
    runIds: ["run_1"],
    scenarioIds: ["scenario_a"],
    ...overrides,
  };
}

function severityOf({
  signature,
  trend = {},
  settledRuns = SETTLED_RUNS,
}: {
  signature: FailureSignature;
  trend?: Record<string, TrendClassification>;
  settledRuns?: number;
}): Severity {
  return computeSeverityPrior({
    signature,
    trendByCriterion: new Map(Object.entries(trend)),
    settledRuns,
  });
}

describe("computeSeverityPrior() across kinds", () => {
  describe("given a judged failure and an error with the same blast radius", () => {
    /** @scenario Infrastructure errors are separated from judged failures */
    it("ranks the judged failure above the error", () => {
      const judged = severityOf({ signature: signatureOf({ kind: "judged" }) });
      const errored = severityOf({
        signature: signatureOf({ kind: "errored", errorShape: "boom" }),
      });
      expect(bySeverityDescending(judged, errored)).toBeLessThan(0);
    });

    it("puts them in different bands", () => {
      expect(severityOf({ signature: signatureOf({ kind: "judged" }) })).toBe(
        "medium",
      );
      expect(
        severityOf({
          signature: signatureOf({ kind: "errored", errorShape: "boom" }),
        }),
      ).toBe("low");
    });
  });

  describe("given an infrastructure failure across the whole run", () => {
    const widespread = {
      runIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"],
      scenarioIds: ["a", "b", "c", "d", "e"],
    };

    /** @scenario Infrastructure errors are separated from judged failures */
    it.each([
      "errored",
      "stalled",
      "cancelled",
    ] as const)("caps a %s signature at medium however widespread", (kind) => {
      expect(
        severityOf({ signature: signatureOf({ kind, ...widespread }) }),
      ).toBe("medium");
    });

    it("leaves a judged failure of the same reach uncapped", () => {
      expect(
        severityOf({
          signature: signatureOf({ kind: "judged", ...widespread }),
        }),
      ).toBe("critical");
    });
  });
});

describe("computeSeverityPrior() blast radius", () => {
  describe("given one failure touching most of the run and another touching one scenario", () => {
    const widespread = signatureOf({
      runIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
    });
    const oneOff = signatureOf({ runIds: ["r1"] });

    /** @scenario A failure that keeps happening outranks a one-off */
    it("ranks the widespread failure higher", () => {
      expect(
        bySeverityDescending(
          severityOf({ signature: widespread }),
          severityOf({ signature: oneOff }),
        ),
      ).toBeLessThan(0);
    });

    /** @scenario A failure that keeps happening outranks a one-off */
    it("puts the widespread failure in a higher band", () => {
      expect(severityOf({ signature: widespread })).toBe("high");
      expect(severityOf({ signature: oneOff })).toBe("medium");
    });
  });

  describe("given nothing settled to measure the radius against", () => {
    it("scores the radius as nothing rather than dividing by zero", () => {
      expect(
        severityOf({
          signature: signatureOf({ runIds: ["r1", "r2"] }),
          settledRuns: 0,
        }),
      ).toBe("medium");
    });
  });
});

describe("computeSeverityPrior() trend adjustments", () => {
  const oneCriterion = signatureOf({ unmetCriterionIds: ["c_one"] });

  /** @scenario The most consequential failure is the first one I read */
  it("raises a failure whose criterion broke since the last run", () => {
    expect(
      severityOf({ signature: oneCriterion, trend: { c_one: "regression" } }),
    ).toBe("high");
  });

  it("raises a failure whose criterion has been failing for a while", () => {
    expect(
      severityOf({
        signature: oneCriterion,
        trend: { c_one: "long_standing" },
      }),
    ).toBe("high");
  });

  /** @scenario A criterion that keeps changing its mind is called unreliable */
  it("lowers a failure whose criteria are all erratic", () => {
    const signature = signatureOf({ unmetCriterionIds: ["c_one", "c_two"] });
    expect(
      severityOf({
        signature,
        trend: { c_one: "unreliable", c_two: "unreliable" },
      }),
    ).toBe("low");
  });

  it("leaves a failure alone when only some of its criteria are erratic", () => {
    const signature = signatureOf({ unmetCriterionIds: ["c_one", "c_two"] });
    expect(
      severityOf({
        signature,
        trend: { c_one: "unreliable", c_two: "stable_fail" },
      }),
    ).toBe("medium");
  });
});

describe("bySeverityDescending()", () => {
  /** @scenario The most consequential failure is the first one I read */
  it("sorts the most consequential first", () => {
    const severities: Severity[] = ["low", "critical", "medium", "high"];
    expect([...severities].sort(bySeverityDescending)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
  });

  it("treats equal severities as ties", () => {
    expect(bySeverityDescending("high", "high")).toBe(0);
  });
});
