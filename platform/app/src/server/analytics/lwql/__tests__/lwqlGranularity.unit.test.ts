/**
 * The granularity contract on its own: what declaring
 * `{period_granularity_seconds:UInt32}` means for one run, and the three ways
 * a surface can get it wrong.
 *
 * Driven directly rather than through the service, because these are the
 * rules every surface inherits — the workbench refuses where this refuses,
 * the dashboard coarsens where `coarsen` is passed, and neither can restate
 * the budget arithmetic.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import {
  LangWatchQLGranularityTooFineError,
  LangWatchQLReservedGranularityTypeError,
} from "../errors";
import {
  LWQL_GRANULARITY_MAX_BUCKETS,
  resolveLangWatchQLGranularity,
} from "../resolveTimeWindow";
import { LWQL_GRANULARITY_STEPS } from "../timeWindow";
import type { LangWatchQLParameter } from "../validation/validate";

const GRANULARITY: LangWatchQLParameter[] = [
  { name: "period_granularity_seconds", type: "UInt32" },
];

const PERIOD: LangWatchQLParameter[] = [
  { name: "period_start", type: "DateTime" },
  { name: "period_end", type: "DateTime" },
];

const WINDOW = {
  start: new Date("2026-02-20T00:00:00.000Z"),
  end: new Date("2026-02-27T00:00:00.000Z"),
};

/** Seven days, in seconds. */
const WEEK_SECONDS = 7 * 24 * 3600;

describe("resolveLangWatchQLGranularity", () => {
  describe("given a statement that does not declare the parameter", () => {
    it("reports no granularity and injects nothing", () => {
      const resolution = resolveLangWatchQLGranularity({
        declared: PERIOD,
        timeWindow: WINDOW,
        granularitySeconds: 60,
      });

      expect(resolution).toEqual({ followsGranularity: false });
    });

    it("is unaffected by a caller-supplied value for an unrelated name", () => {
      const resolution = resolveLangWatchQLGranularity({
        declared: PERIOD,
        parameters: { since: "2026-01-01" },
        timeWindow: WINDOW,
        granularitySeconds: 60,
      });

      expect(resolution.followsGranularity).toBe(false);
    });
  });

  describe("given the parameter declared as UInt32 with a surface step", () => {
    /** @scenario "A statement declaring the granularity parameter runs at the step the workbench supplies" */
    it("follows granularity at the supplied step", () => {
      // An hour over a week: 168 buckets, comfortably inside the ceiling.
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: WINDOW,
        granularitySeconds: 3600,
      });

      expect(resolution).toEqual({
        followsGranularity: true,
        granularitySeconds: 3600,
      });
    });

    /** @scenario "A granularity declared with no step supplied runs on its own authored bucketing" */
    it("runs without a step when the surface offers none, without inventing one", () => {
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: WINDOW,
      });

      // The declaration records intent; the bucketing stays whatever the SQL
      // hard-codes. Inventing a default here would change what a member's
      // chart shows without them asking.
      expect(resolution).toEqual({ followsGranularity: true });
    });
  });

  describe("given the parameter declared with the wrong type", () => {
    /** @scenario "The granularity parameter declared as anything but UInt32 is refused" */
    it.each([
      ["Int32"],
      ["UInt16"],
      ["Float64"],
      ["UInt32('UTC')"],
      ["String"],
    ])("refuses %s at run as well as save", (type) => {
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, { name: "period_granularity_seconds", type }],
          timeWindow: WINDOW,
          granularitySeconds: 60,
        }),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    });

    it("refuses before looking at any supplied value", () => {
      // Wrong type AND zero: the type error is the answer, either way.
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [
            ...PERIOD,
            { name: "period_granularity_seconds", type: "Int64" },
          ],
          parameters: {},
          timeWindow: WINDOW,
          granularitySeconds: 0,
        }),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    });
  });

  describe("given a caller-supplied value for the reserved name", () => {
    /** @scenario "A caller that supplies period_granularity_seconds itself is refused" */
    it("is refused by this resolver even when called on its own", () => {
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          parameters: { period_granularity_seconds: 60 },
          timeWindow: WINDOW,
        }),
      ).toThrow(/surface sets itself/);
    });
  });

  describe("given a malformed surface step", () => {
    /** @scenario "A zero or fractional step is refused as a wrong declaration" */
    it.each([
      [0],
      [-60],
      [1.5],
    ])("refuses %p as a wrong declaration", (step) => {
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: step,
        }),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    });
  });

  describe("given the bucket budget overflows", () => {
    // A week at one-second steps: 604,800 buckets, far past the ceiling.
    it("refuses on a caller-owned surface", () => {
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: 1,
          onBudgetOverflow: "refuse",
        }),
      ).toThrow(LangWatchQLGranularityTooFineError);
    });

    it("carries the arithmetic in the refusal's meta", () => {
      try {
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: 1,
          onBudgetOverflow: "refuse",
        });
        throw new Error("expected the refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(LangWatchQLGranularityTooFineError);
        const handled = error as LangWatchQLGranularityTooFineError;
        expect(handled.meta).toMatchObject({
          requestedGranularitySeconds: 1,
          windowSeconds: WEEK_SECONDS,
          maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
        });
      }
    });

    it("coarsens to the finest fitting offered step on the dashboard", () => {
      // A week at one-minute steps is 10,080 buckets -- just past the
      // ceiling, and itself evidence that the 10,000 default has teeth:
      // a completely ordinary chart/range pairing lands on the wrong side
      // of it. The finest offered step that fits is the hour (168).
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: WINDOW,
        granularitySeconds: 60,
        onBudgetOverflow: "coarsen",
      });

      expect(resolution.granularitySeconds).toBe(3600);
      expect(resolution.coarsenedFromSeconds).toBe(60);
    });

    it("does not report coarsening when the requested step already fits", () => {
      // An hour over a week: 168 buckets. Fits.
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: WINDOW,
        granularitySeconds: 3600,
        onBudgetOverflow: "coarsen",
      });

      expect(resolution).toEqual({
        followsGranularity: true,
        granularitySeconds: 3600,
      });
    });

    it("coarsens to the coarsest floor when nothing fits, still naming the change", () => {
      // Ten years at an hour: ~87,600 buckets. Nothing fits.
      const decade = {
        start: new Date("2026-02-20T00:00:00.000Z"),
        end: new Date("2036-02-20T00:00:00.000Z"),
      };
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: decade,
        granularitySeconds: 60,
        onBudgetOverflow: "coarsen",
      });

      expect(resolution.granularitySeconds).toBe(3600);
      expect(resolution.coarsenedFromSeconds).toBe(60);
    });
  });

  describe("given a window whose length lands exactly on the ceiling boundary", () => {
    it("admits a bucket count equal to the ceiling — overflow is strictly greater-than", () => {
      // A 10,000-second window at one-second steps: exactly the ceiling.
      // Integer-exact by construction -- the float-division route (% !== 0)
      // was itself a test bug, not a property of the contract.
      const start = new Date("2026-02-20T00:00:00.000Z");
      const end = new Date(
        start.getTime() + LWQL_GRANULARITY_MAX_BUCKETS * 1000,
      );
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        timeWindow: { start, end },
        granularitySeconds: 1,
        onBudgetOverflow: "refuse",
      });

      expect(resolution.granularitySeconds).toBe(1);
    });

    it("refuses one bucket past the ceiling", () => {
      const start = new Date("2026-02-20T00:00:00.000Z");
      const end = new Date(
        start.getTime() + (LWQL_GRANULARITY_MAX_BUCKETS + 1) * 1000,
      );
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: { start, end },
          granularitySeconds: 1,
          onBudgetOverflow: "refuse",
        }),
      ).toThrow(LangWatchQLGranularityTooFineError);
    });
  });

  describe("given a declared granularity but no period bounds declared alongside", () => {
    // The save-time rule (assertLangWatchQLGranularityDeclaration) refuses
    // this shape before it can persist; the run path can still see it from a
    // chart persisted before that rule existed, so the resolver fails soft:
    // no window means no budget to compute, and the statement runs on its
    // own authored bucketing.
    it("runs at the supplied step rather than guessing a budget", () => {
      // Nothing to compute the budget against, so the supplied step rides
      // through unclamped -- there is no range it could overflow.
      const resolution = resolveLangWatchQLGranularity({
        declared: GRANULARITY,
        granularitySeconds: 60,
      });

      expect(resolution).toEqual({
        followsGranularity: true,
        granularitySeconds: 60,
      });
    });
  });
});

describe("the offered granularity steps", () => {
  // A day-scale step must not join these until a timezone-aware mechanism
  // exists: a fixed 86,400-second bucket drifts off local midnight on DST
  // transition days (see the note on LWQL_GRANULARITY_STEPS in timeWindow.ts).
  it("offers exactly one second, one minute and one hour", () => {
    expect([...LWQL_GRANULARITY_STEPS]).toEqual([1, 60, 3600]);
  });
});
