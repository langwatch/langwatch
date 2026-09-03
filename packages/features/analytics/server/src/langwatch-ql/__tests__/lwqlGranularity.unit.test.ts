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
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import {
  LangWatchQLGranularityTooFineError,
  LangWatchQLReservedGranularityTypeError,
} from "../errors";
import { LWQL_GRANULARITY_MAX_BUCKETS, resolveLangWatchQLGranularity } from "../resolve-time-window";
import { LWQL_GRANULARITY_STEPS } from "@langwatch/analytics-contract";
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

/** The `code` of a thrown handled error, or the reason there is none. */
function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "<no error was thrown>";
}

/** The `message` of a thrown error, or the reason there is none. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "<no error was thrown>";
}

/** The `meta` of a thrown handled error, empty when nothing was thrown. */
function metaOf(run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    return ((error as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, unknown>;
  }
  return {};
}

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

    /** @scenario "The resolver reports an unfilled declared granularity rather than inventing a step" */
    it("resolves without a step when the surface offers none, without inventing one", () => {
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
    it.each([["Int32"], ["UInt16"], ["Float64"], ["UInt32('UTC')"], ["String"]])(
      "refuses %s at run as well as save",
      (type) => {
        expect(() =>
          resolveLangWatchQLGranularity({
            declared: [...PERIOD, { name: "period_granularity_seconds", type }],
            timeWindow: WINDOW,
            granularitySeconds: 60,
          }),
        ).toThrow(LangWatchQLReservedGranularityTypeError);
      },
    );

    it("reports the wrong declared type, not the bad step, when both are wrong", () => {
      // Wrong type AND zero: the declaration is what the author must fix
      // first, so its copy is the answer either way.
      const run = () =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, { name: "period_granularity_seconds", type: "Int64" }],
          parameters: {},
          timeWindow: WINDOW,
          granularitySeconds: 0,
        });

      expect(() => run()).toThrow(LangWatchQLReservedGranularityTypeError);
      expect(messageOf(run)).toContain("not UInt32");
    });
  });

  describe("given a caller-supplied value for the reserved name", () => {
    const suppliesGranularity = () =>
      resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        parameters: { period_granularity_seconds: 60 },
        timeWindow: WINDOW,
      });

    /** @scenario "Reserved parameter misuse is refused before execution" */
    it("is refused by this resolver even when called on its own", () => {
      expect(codeOf(suppliesGranularity)).toBe("lwql_reserved_parameter_supplied");
    });

    it("names the granularity parameter rather than the window pair", () => {
      // The refusal used to say "time-window parameters" whatever was sent,
      // so a caller that supplied only the step was told to remove two
      // parameters it had never sent, and not the one it had.
      const message = messageOf(suppliesGranularity);

      expect(message).toContain("period_granularity_seconds");
      expect(message).not.toContain("period_start");
      expect(message).not.toContain("period_end");
    });

    it("does not reject a caller parameter that is not a surface name", () => {
      // The guard's own reserved name is period_granularity_seconds; a
      // member's own parameter must ride through untouched even when a
      // genuine granularity declaration and step are present alongside it.
      const resolution = resolveLangWatchQLGranularity({
        declared: [...PERIOD, ...GRANULARITY],
        parameters: { minTraceCount: 5 },
        timeWindow: WINDOW,
        granularitySeconds: 3600,
      });

      expect(resolution).toEqual({
        followsGranularity: true,
        granularitySeconds: 3600,
      });
    });
  });

  describe("given a malformed surface step", () => {
    /** @scenario "A zero or fractional step is refused as a wrong declaration" */
    it.each([[0], [-60], [1.5]])("refuses %p as a malformed step", (step) => {
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: step,
        }),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    });

    it("describes the step rather than claiming the declaration is mistyped", () => {
      // The declaration here is a correct UInt32. Copy blaming its type sends
      // the author to a line that is already right.
      const run = () =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: 1.5,
        });

      expect(codeOf(run)).toBe("lwql_granularity_parameter_type");
      expect(messageOf(run)).not.toContain("UInt32");
      // The check is list-membership, not integer-ness: 7,200 is a whole
      // number of seconds and is still refused, so the copy names the list.
      expect(messageOf(run)).toContain("offered steps");
      expect(messageOf(run)).toContain("1 second, 1 minute, or 1 hour");
    });

    it("refuses a positive whole step the surface does not offer", () => {
      // 7,200 is a positive integer, so the old positive-integer check let it
      // through -- and coarsening would then have "coarsened" it to the
      // 3,600-second hour, a step twice as fine as the one requested.
      expect(() =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: 7200,
          onBudgetOverflow: "coarsen",
        }),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    });

    it("admits every step the surface offers", () => {
      for (const step of LWQL_GRANULARITY_STEPS) {
        expect(() =>
          resolveLangWatchQLGranularity({
            declared: [...PERIOD, ...GRANULARITY],
            timeWindow: WINDOW,
            granularitySeconds: step,
            onBudgetOverflow: "coarsen",
          }),
        ).not.toThrow();
      }
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
      const run = () =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: WINDOW,
          granularitySeconds: 1,
          onBudgetOverflow: "refuse",
        });

      expect(() => run()).toThrow(LangWatchQLGranularityTooFineError);
      expect(codeOf(run)).toBe("lwql_granularity_too_fine");
      expect(metaOf(run)).toMatchObject({
        requestedGranularitySeconds: 1,
        windowSeconds: WEEK_SECONDS,
        maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
      });
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

    it("never reports coarsening to a step finer than the one requested", () => {
      // The invariant the label promises: wherever coarsenedFromSeconds is
      // set, the effective step is strictly wider than the requested one.
      //
      // The refusal above is what makes the finer-than-requested case
      // unreachable through this entry point, so this sweep holds on the old
      // `effective !== requested` code too -- it pins the property rather
      // than falsifying the bug. The test that fails on the pre-fix code is
      // "refuses a positive whole step the surface does not offer": 7,200
      // used to reach coarsening and come back labelled as widened to 3,600.
      const windows = [
        WINDOW,
        {
          // Exactly 10,000 hours: the widest window whose one-hour floor
          // still fits the ceiling, so every step resolves rather than
          // refusing (a wider window refuses -- pinned below).
          start: new Date("2026-02-20T00:00:00.000Z"),
          end: new Date(
            new Date("2026-02-20T00:00:00.000Z").getTime() +
              LWQL_GRANULARITY_MAX_BUCKETS * 3600 * 1000,
          ),
        },
      ];

      for (const timeWindow of windows) {
        for (const step of LWQL_GRANULARITY_STEPS) {
          const resolution = resolveLangWatchQLGranularity({
            declared: [...PERIOD, ...GRANULARITY],
            timeWindow,
            granularitySeconds: step,
            onBudgetOverflow: "coarsen",
          });

          if (resolution.coarsenedFromSeconds !== undefined) {
            expect(resolution.granularitySeconds).toBeGreaterThan(resolution.coarsenedFromSeconds);
          }
        }
      }
    });

    /** @scenario "A window too wide for even the coarsest offered step is refused everywhere" */
    it("refuses when even the coarsest offered step still overflows, coarsening or not", () => {
      // Ten years at the one-hour floor: ~87,600 buckets. Nothing fits, and
      // the ceiling is a hard browser-safety cap -- an answer carrying nine
      // times the budget must not come back looking in-budget.
      const decade = {
        start: new Date("2026-02-20T00:00:00.000Z"),
        end: new Date("2036-02-20T00:00:00.000Z"),
      };
      const run = () =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: decade,
          granularitySeconds: 60,
          onBudgetOverflow: "coarsen",
        });

      expect(() => run()).toThrow(LangWatchQLGranularityTooFineError);
      expect(codeOf(run)).toBe("lwql_granularity_too_fine");
      // The refusal names the caller's own step and the window, the same
      // arithmetic the refuse path carries.
      expect(metaOf(run)).toMatchObject({
        requestedGranularitySeconds: 60,
        maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
      });
    });

    it("refuses the nothing-fits window even at the coarsest offered step", () => {
      // The same nothing-fits decade, asked for at the COARSEST offered step.
      // There is no silent floor fallback: the ceiling is a hard cap, so a
      // window even the coarsest step overflows refuses on the coarsen door
      // exactly as it does on the refuse door.
      const decade = {
        start: new Date("2026-02-20T00:00:00.000Z"),
        end: new Date("2036-02-20T00:00:00.000Z"),
      };
      const coarsest = LWQL_GRANULARITY_STEPS[LWQL_GRANULARITY_STEPS.length - 1];

      const run = () =>
        resolveLangWatchQLGranularity({
          declared: [...PERIOD, ...GRANULARITY],
          timeWindow: decade,
          granularitySeconds: coarsest,
          onBudgetOverflow: "coarsen",
        });

      expect(codeOf(run)).toBe("lwql_granularity_too_fine");
      expect(metaOf(run)).toMatchObject({
        requestedGranularitySeconds: coarsest,
        maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
      });
    });
  });

  describe("given a window whose length lands exactly on the ceiling boundary", () => {
    it("admits a bucket count equal to the ceiling — overflow is strictly greater-than", () => {
      // A 10,000-second window at one-second steps: exactly the ceiling.
      // Integer-exact by construction -- the float-division route (% !== 0)
      // was itself a test bug, not a property of the contract.
      const start = new Date("2026-02-20T00:00:00.000Z");
      const end = new Date(start.getTime() + LWQL_GRANULARITY_MAX_BUCKETS * 1000);
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
      const end = new Date(start.getTime() + (LWQL_GRANULARITY_MAX_BUCKETS + 1) * 1000);
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

describe("the bucket ceiling", () => {
  // Pinned because the coarsening cases above are written against this exact
  // number -- a week at one-minute steps is 10,080 buckets, and only just
  // overflows. Move the ceiling and those cases stop testing what they say.
  it("admits ten thousand buckets per governed run", () => {
    expect(LWQL_GRANULARITY_MAX_BUCKETS).toBe(10_000);
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
