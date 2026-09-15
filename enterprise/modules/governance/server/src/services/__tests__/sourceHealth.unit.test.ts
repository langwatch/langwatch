// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which days a pull actually reached, and what a source that has never
 * finished a run is allowed to say about itself.
 *
 * Every honesty rule on the cost screen reasons from a moment. Until now that
 * moment was the instant the last run FINISHED, which is only the right one
 * when the run drained everything on offer. A run stopped by a page limit or
 * by its own deadline finishes at the same kind of instant while having read
 * far less, and a provider that publishes late leaves a gap even behind a run
 * that drained perfectly. Both shapes hand a reader "no spend" for a day
 * nobody ever read.
 *
 * So the moment these read is the point the data reaches — the newest bucket
 * the run actually read through to — and never the run's own clock.
 *
 * Spec: specs/governance/ingestion-source-health.feature
 * Decision: ADR-128.
 */
import { describe, expect, it } from "vitest";

import { isDayCoveredByPull, noDataSinceNotice } from "@langwatch/enterprise-governance-contract";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Mid-morning on a day, so a day boundary and a read-through point differ. */
const READ_THROUGH_MS = Date.parse("2026-01-15T10:30:00.000Z");
/** The run kept going for another two days after the point it read through to. */
const RUN_FINISHED_MS = READ_THROUGH_MS + 2 * ONE_DAY_MS;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

describe("given the source's last run stopped before the end", () => {
  describe("when a viewer looks at a day after the point that run read through to", () => {
    /** @scenario "A day a run never reached is not treated as collected" */
    it("reports the day as not collected", () => {
      // The run finished on the 17th and read through to the 15th. The 16th
      // is a day nobody asked the provider about, and calling it collected is
      // what turns it into a day shown as costing nothing.
      expect(
        isDayCoveredByPull({
          dayStartMs: dayStart("2026-01-16"),
          lastSuccessfulPullMs: RUN_FINISHED_MS,
          readThroughMs: READ_THROUGH_MS,
        }),
      ).toBe(false);
    });

    /** @scenario "A day a run never reached is not treated as collected" */
    it("still reports a day the run did read through as collected", () => {
      // The arm from the far side: without it the rule above is satisfied by
      // a reader that calls every day uncollected, and the screen would show
      // "unknown" for a source working perfectly.
      expect(
        isDayCoveredByPull({
          dayStartMs: dayStart("2026-01-14"),
          lastSuccessfulPullMs: RUN_FINISHED_MS,
          readThroughMs: READ_THROUGH_MS,
        }),
      ).toBe(true);
    });
  });
});

describe("given a run that finished without error", () => {
  describe("when the newest figures the provider had published were older than the run", () => {
    /** @scenario "A day the provider had not yet published is not treated as collected" */
    it("reports a day between the two as not collected", () => {
      // A run that genuinely drained everything on offer still stops where
      // the provider stops. Reasoning from the clock rather than from the
      // data claims a day was collected on every provider that publishes
      // late — which is all of them, by a day or more.
      expect(
        isDayCoveredByPull({
          dayStartMs: dayStart("2026-01-16"),
          lastSuccessfulPullMs: RUN_FINISHED_MS,
          readThroughMs: READ_THROUGH_MS,
        }),
      ).toBe(false);
    });
  });
});

describe("given a source whose runs have all stopped before the end", () => {
  describe("when a viewer looks at where the figures stop being complete", () => {
    /** @scenario "A source that has never finished a run still says how far it got" */
    it("says it collected up to the point it reached and has not finished", () => {
      // Silence is the worst answer available here. A source that has never
      // completed a run has no successful run to date a gap from, so a rule
      // that reads only that date drops the one source most likely to be
      // wrong — and the reader is shown nothing at all about it.
      const notice = noDataSinceNotice({
        status: "active",
        errorCount: 0,
        lastSuccessAt: null,
        completeness: "truncated",
        readThroughAt: new Date(READ_THROUGH_MS),
      });

      expect(notice).toEqual({
        readThroughIso: "2026-01-15T10:30:00.000Z",
        finished: false,
      });
    });

    /** @scenario "A source that has never finished a run still says how far it got" */
    it("is not passed over the way a source with nothing to report is", () => {
      // The same source read through the rule that decides whether there is
      // anything to say at all. Null here is what drops it off the screen.
      expect(
        noDataSinceNotice({
          status: "active",
          errorCount: 0,
          lastSuccessAt: null,
          completeness: "truncated",
          readThroughAt: new Date(READ_THROUGH_MS),
        }),
      ).not.toBeNull();
    });
  });
});
