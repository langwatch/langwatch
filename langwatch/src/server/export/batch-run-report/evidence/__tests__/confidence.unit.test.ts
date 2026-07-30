import { describe, expect, it } from "vitest";
import { buildPassRateFact, wilsonInterval } from "../confidence";

/**
 * How much a pass rate is worth believing.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

describe("wilsonInterval()", () => {
  describe("given nothing has settled", () => {
    it("returns no interval", () => {
      expect(wilsonInterval({ successes: 0, total: 0 })).toBeNull();
    });
  });

  describe("given any sample", () => {
    const samples = [
      { successes: 0, total: 1 },
      { successes: 1, total: 1 },
      { successes: 3, total: 4 },
      { successes: 0, total: 200 },
      { successes: 100, total: 200 },
      { successes: 190, total: 200 },
    ];

    it.each(
      samples,
    )("keeps $successes/$total inside nought to a hundred", (sample) => {
      const interval = wilsonInterval(sample);
      expect(interval?.low).toBeGreaterThanOrEqual(0);
      expect(interval?.high).toBeLessThanOrEqual(100);
    });

    it.each(samples)("orders $successes/$total low before high", (sample) => {
      const interval = wilsonInterval(sample);
      expect(interval!.low).toBeLessThanOrEqual(interval!.high);
    });
  });

  describe("given every run failed", () => {
    /** @scenario A small sample is reported as a small sample */
    it("still leaves room for doubt rather than collapsing to a point", () => {
      const interval = wilsonInterval({ successes: 0, total: 10 });
      expect(interval!.high - interval!.low).toBeGreaterThan(0);
    });
  });

  describe("given every run passed", () => {
    /** @scenario A small sample is reported as a small sample */
    it("still leaves room for doubt rather than claiming certainty", () => {
      const interval = wilsonInterval({ successes: 10, total: 10 });
      expect(interval!.high - interval!.low).toBeGreaterThan(0);
      expect(interval!.low).toBeLessThan(100);
    });
  });
});

describe("buildPassRateFact()", () => {
  describe("given nothing has settled", () => {
    const fact = buildPassRateFact({ passedCount: 0, settledCount: 0 });

    it("reports no rate rather than nought per cent", () => {
      expect(fact.value).toBeNull();
      expect(fact.ci95).toBeNull();
    });

    it("refuses to draw a conclusion", () => {
      expect(fact.tooFewToConclude).toBe(true);
      expect(fact.settled).toBe(0);
    });
  });

  describe("given a run of four scenarios where three failed", () => {
    const fact = buildPassRateFact({ passedCount: 1, settledCount: 4 });

    /** @scenario A small sample is reported as a small sample */
    it("says there were too few runs to draw a conclusion", () => {
      expect(fact.tooFewToConclude).toBe(true);
    });

    it("still carries the counts the rate came from", () => {
      expect(fact.settled).toBe(4);
      expect(fact.value).toBeCloseTo(25);
    });
  });

  describe("given just enough runs but a wide interval", () => {
    const fact = buildPassRateFact({ passedCount: 4, settledCount: 8 });

    /** @scenario A small sample is reported as a small sample */
    it("refuses to conclude because the margin is too wide", () => {
      expect(fact.tooFewToConclude).toBe(true);
      expect(fact.ci95!.high - fact.ci95!.low).toBeGreaterThan(30);
    });
  });

  describe("given plenty of runs whose outcomes varied widely", () => {
    // A real run: 10 of 21 passed. Comfortably past the sample threshold, and
    // the interval still spans roughly 28% to 68%.
    const fact = buildPassRateFact({ passedCount: 10, settledCount: 21 });

    /**
     * The two ways a rate becomes unquotable call for opposite reactions —
     * run more scenarios, versus the agent is inconsistent — so calling
     * twenty-one runs "too few" is both wrong and the wrong advice.
     *
     * @scenario A small sample is reported as a small sample
     */
    it("blames the spread rather than the sample size", () => {
      expect(fact.tooFewToConclude).toBe(true);
      expect(fact.inconclusiveReason).toBe("spread_too_wide");
    });
  });

  describe("given fewer runs than can support a rate", () => {
    /** @scenario A small sample is reported as a small sample */
    it("blames the sample size", () => {
      expect(
        buildPassRateFact({ passedCount: 1, settledCount: 4 })
          .inconclusiveReason,
      ).toBe("too_few_runs");
    });
  });

  describe("given a run of two hundred scenarios", () => {
    const fact = buildPassRateFact({ passedCount: 190, settledCount: 200 });

    /** @scenario A large enough sample states its rate with a margin */
    it("states the pass rate", () => {
      expect(fact.value).toBeCloseTo(95);
    });

    /** @scenario A large enough sample states its rate with a margin */
    it("states the range the true rate is likely to sit in", () => {
      expect(fact.ci95!.low).toBeGreaterThan(88);
      expect(fact.ci95!.high).toBeLessThan(100);
    });

    it("draws a conclusion from it", () => {
      expect(fact.tooFewToConclude).toBe(false);
    });
  });
});
