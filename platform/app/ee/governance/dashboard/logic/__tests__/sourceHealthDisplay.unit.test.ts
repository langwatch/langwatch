// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the source badge says when configuration and health disagree, and when
 * the "no data since" line appears under it.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Spec: specs/governance/ingestion-source-health.feature
 * Decision: ADR-128.
 *
 * The load-bearing case is a DISABLED source that is also failing. Both facts
 * are true and the badge can only say one of them, so the order of the two
 * checks is the whole behaviour — and it is invisible in the function until
 * something asserts it.
 */

import { UNHEALTHY_AFTER_CONSECUTIVE_FAILURES } from "@ee/governance/services/pullers/sourceHealth";
import { describe, expect, it } from "vitest";
import {
  noDataSinceNotice,
  SOURCE_PARTIAL_META,
  SOURCE_STATUS_META,
  SOURCE_UNHEALTHY_META,
  sourceBadge,
} from "../sourceHealthDisplay";

/** Enough consecutive failures to be called unhealthy, whatever the cutoff is. */
const FAILING = UNHEALTHY_AFTER_CONSECUTIVE_FAILURES;

describe("sourceBadge", () => {
  describe("given a source an admin disabled", () => {
    describe("when its last runs all failed", () => {
      it("says disabled", () => {
        // A disabled source is not expected to be pulling, so "Pulls failing" is
        // not news about it — it is the configured state, restated in red.
        expect(
          sourceBadge({ status: "disabled", errorCount: FAILING }),
        ).toEqual(SOURCE_STATUS_META.disabled);
      });
    });

    describe("when it is not failing either", () => {
      it("says disabled", () => {
        expect(sourceBadge({ status: "disabled", errorCount: 0 })).toEqual(
          SOURCE_STATUS_META.disabled,
        );
      });
    });
  });

  describe("given a source an admin left active", () => {
    describe("when it has failed enough times in a row", () => {
      it("says not pulling", () => {
        expect(sourceBadge({ status: "active", errorCount: FAILING })).toEqual(
          SOURCE_UNHEALTHY_META,
        );
      });
    });

    describe("when its failures are still below the cutoff", () => {
      it("still says active", () => {
        expect(
          sourceBadge({ status: "active", errorCount: FAILING - 1 }),
        ).toEqual(SOURCE_STATUS_META.active);
      });
    });
  });

  describe("given a status the badge has no entry for", () => {
    describe("when the badge is asked for it", () => {
      it("falls back to awaiting first event rather than rendering nothing", () => {
        expect(sourceBadge({ status: "something_new", errorCount: 0 })).toEqual(
          SOURCE_STATUS_META.awaiting_first_event,
        );
      });
    });
  });
});

describe("noDataSinceNotice", () => {
  const lastSuccessAt = new Date("2026-08-01T10:00:00.000Z");

  describe("given an active source that has failed enough times in a row", () => {
    describe("when it pulled successfully at some point before", () => {
      it("names the last success", () => {
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt,
          }),
        ).toEqual({
          lastSuccessIso: "2026-08-01T10:00:00.000Z",
        });
      });
    });

    describe("when that timestamp arrives as a string, the shape the API returns", () => {
      it("names the last success just the same", () => {
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt: "2026-08-01T10:00:00.000Z",
          }),
        ).toEqual({ lastSuccessIso: "2026-08-01T10:00:00.000Z" });
      });
    });

    describe("when it has never pulled successfully", () => {
      it("stays silent", () => {
        // There is no "since" to name, and the awaiting-first-event badge
        // already covers this case.
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt: null,
          }),
        ).toBeNull();
      });
    });
  });

  describe("given an active source that is healthy", () => {
    describe("when it has a last success to name", () => {
      it("stays silent anyway", () => {
        expect(
          noDataSinceNotice({ status: "active", errorCount: 0, lastSuccessAt }),
        ).toBeNull();
      });
    });
  });

  describe("given a source an admin disabled", () => {
    describe("when its last runs all failed", () => {
      it("stays silent", () => {
        // Both facts are true and only one line can be shown. A source nobody
        // asked to run has not "stopped pulling", and the badge already says
        // Disabled — an outage notice under it sends the reader to fix
        // nothing.
        expect(
          noDataSinceNotice({
            status: "disabled",
            errorCount: FAILING,
            lastSuccessAt,
          }),
        ).toBeNull();
      });
    });
  });
});

/**
 * A run that stopped at a page limit or ran out of time ends with nothing to
 * report as an error, so the source read as active and the moment that run
 * finished read as the point the data reaches. Both are wrong, and the second
 * is the worse of the two: it is the one sentence on the page a reader would
 * take as proof the period is whole.
 */
describe("given a source whose last run stopped before the end", () => {
  // A read that got as far as mid-morning, on a run that then finished at
  // noon. The gap between the two is the whole subject.
  const readThroughAt = new Date("2026-01-15T10:30:00.000Z");
  const runFinishedAt = new Date("2026-01-15T12:00:00.000Z");

  describe("when a viewer looks at the source", () => {
    /** @scenario "A source whose last run stopped early is shown as partly collected" */
    it("reads as partly collected rather than as active", () => {
      expect(
        sourceBadge({
          status: "active",
          errorCount: 0,
          completeness: "truncated",
        }),
      ).toBe(SOURCE_PARTIAL_META);
      expect(SOURCE_PARTIAL_META.label).toBe("Partly collected");
    });

    /** @scenario "A source whose last run stopped early is shown as partly collected" */
    it("names the date and the time it read through to, and no date for the collection that never finished", () => {
      const notice = noDataSinceNotice({
        status: "active",
        errorCount: 0,
        lastSuccessAt: runFinishedAt,
        completeness: "truncated",
        readThroughAt,
      });

      // Never null for a truncated source, however healthy its failure count
      // makes it look.
      expect(notice).not.toBeNull();
      // The point carries a time as well as a date: a page limit stops in the
      // middle of a day, and a date alone rounds that day up to reached.
      expect(notice).toEqual({
        readThroughIso: "2026-01-15T10:30:00.000Z",
        finished: false,
      });
      // And the instant the run happened to finish is not offered as a date
      // anything was collected through.
      expect(JSON.stringify(notice)).not.toContain("12:00:00");
    });

    /** @scenario "A source whose last run stopped early is shown as partly collected" */
    it("still reads as active when the last run did reach the end", () => {
      // The arm from the far side: without it the rule above is satisfied by
      // a badge that calls every source partly collected.
      expect(
        sourceBadge({
          status: "active",
          errorCount: 0,
          completeness: "complete",
        }),
      ).toBe(SOURCE_STATUS_META.active);
    });
  });
});

/**
 * A source that is STUCK, as opposed to one that stopped early once.
 *
 * Nothing on the page separates the two except the point itself: a source
 * that truncated once and then finished reads as active again with a later
 * point, and one that is stuck reads as partly collected with a point that
 * never moves. Elapsed time is not something anything here measures, so the
 * point is the only evidence available — which is why it must be read off
 * what the run actually reached and never off the run's own clock, the one
 * value that DOES move on every attempt.
 */
describe("given a source whose runs keep stopping at the same point", () => {
  /** Every run reaches the same bucket and then gives up. */
  const stuckAt = new Date("2026-01-15T10:30:00.000Z");
  /** Each attempt finishes later than the last, and none of them read further. */
  const runsFinishedAt = [
    new Date("2026-01-15T12:00:00.000Z"),
    new Date("2026-01-16T12:00:00.000Z"),
    new Date("2026-01-17T12:00:00.000Z"),
  ];

  describe("when a viewer looks at it after several of those runs", () => {
    /** @scenario "A source stuck half-read keeps reporting the same stopped-at point" */
    it("still reads as partly collected and reports the point the run before it did", () => {
      const seenAfterEachRun = runsFinishedAt.map((lastSuccessAt) => ({
        badge: sourceBadge({
          status: "active",
          errorCount: 0,
          completeness: "truncated",
        }),
        notice: noDataSinceNotice({
          status: "active",
          errorCount: 0,
          lastSuccessAt,
          completeness: "truncated",
          readThroughAt: stuckAt,
        }),
      }));

      // Asserted before the loop: a `for` over an empty list passes without
      // checking anything, which is how a test like this stops being one.
      expect(seenAfterEachRun).toHaveLength(3);
      for (const seen of seenAfterEachRun) {
        expect(seen.badge).toBe(SOURCE_PARTIAL_META);
        expect(seen.notice).toEqual({
          readThroughIso: "2026-01-15T10:30:00.000Z",
          finished: false,
        });
      }
    });

    /** @scenario "A source stuck half-read keeps reporting the same stopped-at point" */
    it("reads as active again with a later point once a run does reach the end", () => {
      // The other half of the only distinction the page offers. Without it,
      // a display that froze the point forever would satisfy the rule above.
      const finishedAt = new Date("2026-01-18T12:00:00.000Z");

      expect(
        sourceBadge({
          status: "active",
          errorCount: 0,
          completeness: "complete",
        }),
      ).toBe(SOURCE_STATUS_META.active);
      expect(
        noDataSinceNotice({
          status: "active",
          errorCount: 0,
          lastSuccessAt: finishedAt,
          completeness: "complete",
          readThroughAt: finishedAt,
        }),
      ).toBeNull();
    });
  });
});

/**
 * A status that names something on Object's prototype.
 *
 * `status` is a free-form column, so the badge table gets indexed by a string
 * this build never chose. Every unknown word falls back correctly except the
 * handful naming an inherited member: those resolve up the prototype chain to
 * a real value, and `??` only treats null and undefined as missing. The badge
 * then carries no icon, and rendering an undefined component throws, so the
 * page dies rather than degrading to "Awaiting first event".
 *
 * `__proto__` is in the list because it is the one that does not fit the
 * summary. The others resolve to a Function; `__proto__` resolves to
 * Object.prototype, an object. Anything asserting "not a function" would wave
 * it through, which is why the load-bearing assertion below is identity
 * against the fallback and not a typeof check.
 *
 * The control case is the point of the whole block. A test that reaches for a
 * plausible unknown word passes against the broken lookup, because ordinary
 * words are not inherited. Only naming the inherited ones finds it.
 */
describe("a status naming an inherited property", () => {
  const INHERITED = [
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__proto__",
  ];

  it.each(INHERITED)("falls back to the awaiting badge for %s", (status) => {
    const badge = sourceBadge({ status, errorCount: 0 });

    // Identity, not shape: `__proto__` would satisfy a shape check.
    expect(badge).toBe(SOURCE_STATUS_META.awaiting_first_event);
    expect(badge.icon).toBeDefined();
  });

  it("control: an ordinary unknown word already fell back before the fix", () => {
    expect(sourceBadge({ status: "quota_exhausted_v2", errorCount: 0 })).toBe(
      SOURCE_STATUS_META.awaiting_first_event,
    );
  });
});
