/**
 * Regression: a continuously-poked organization must still get its usage
 * report.
 *
 * The defect this guards is not "a flag is missing" — it is a dynamic. A
 * dedup window that *extends* on every squash re-scores an already-staged
 * job to `occurredAt + delay` on every poke, and a job only dispatches once
 * its score is in the past. So an organization whose projects never stop
 * producing billable events would push its own report five minutes further
 * into the future every time a poke lands, and the report would never come
 * due — the organizations with the most billable traffic are the ones with
 * the largest invoices.
 *
 * The model below is a minimal simulation of that staging dynamic (not the
 * real queue, which does not exist yet for this pipeline — see `index.ts`'s
 * docblock), driven directly off `reportUsageForMonthDispatchOptions` so
 * reverting `extend: false` turns this test red rather than leaving the
 * regression undetected until a real dispatcher exists.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { describe, expect, it } from "vitest";
import { renderGroupKey } from "@langwatch/event-sourcing";

import { reportUsageForMonthDispatchOptions, reportUsageForMonthGroupKey } from "../dispatchOptions";

/** One dedup id's worth of staging: at most one staged job, plus the dedup key that points at it. */
class StagedReport {
  private stagedScore: number | null = null;
  private dedupExpiresAt = 0;
  readonly dispatchedAt: number[] = [];

  constructor(
    private readonly delayMs: number,
    private readonly dedupTtlMs: number,
    private readonly extend: boolean,
  ) {}

  /** A poke (or a sweep) sends the command. */
  stage(now: number): void {
    const dispatchAfter = now + this.delayMs;
    const dedupAlive = now < this.dedupExpiresAt;

    if (dedupAlive && this.stagedScore !== null) {
      if (this.extend) {
        this.stagedScore = dispatchAfter;
      }
    } else {
      this.stagedScore = dispatchAfter;
    }
    this.dedupExpiresAt = now + this.dedupTtlMs;
  }

  /** The dispatch loop, which only ever takes jobs whose score is in the past. */
  drain(now: number): void {
    if (this.stagedScore !== null && this.stagedScore <= now) {
      this.dispatchedAt.push(this.stagedScore);
      this.stagedScore = null;
    }
  }
}

function pokeContinuously({
  delayMs,
  dedupTtlMs,
  extend,
  pokeEveryMs,
  forMs,
}: {
  delayMs: number;
  dedupTtlMs: number;
  extend: boolean;
  pokeEveryMs: number;
  forMs: number;
}): number[] {
  const report = new StagedReport(delayMs, dedupTtlMs, extend);
  const stepMs = 1_000;

  for (let now = 0; now <= forMs; now += stepMs) {
    if (now % pokeEveryMs === 0) {
      report.stage(now);
    }
    report.drain(now);
  }

  return report.dispatchedAt;
}

describe("reportUsageForMonthDispatchOptions", () => {
  describe("given an organization poked inside every window, without a gap", () => {
    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("dispatches the usage report once per debounce window", () => {
      const { delayMs, deduplication } = reportUsageForMonthDispatchOptions;

      const dispatchedAt = pokeContinuously({
        delayMs,
        dedupTtlMs: deduplication.ttlMs,
        extend: deduplication.extend,
        pokeEveryMs: delayMs,
        forMs: delayMs * 6,
      });

      // The first report ran at the moment its own window closed, not later.
      expect(dispatchedAt[0]).toBe(delayMs);
      expect(dispatchedAt.length).toBeGreaterThanOrEqual(3);

      // And the reports keep coming: no gap grows without bound, which is
      // the property the starvation destroyed.
      const gaps = dispatchedAt.slice(1).map((at, index) => at - (dispatchedAt[index] as number));
      for (const gap of gaps) {
        expect(gap).toBeLessThanOrEqual(delayMs * 2);
      }
    });

    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("never dispatches at all when the window is allowed to extend (the pre-fix defect)", () => {
      const { delayMs, deduplication } = reportUsageForMonthDispatchOptions;

      const dispatchedAt = pokeContinuously({
        delayMs,
        dedupTtlMs: deduplication.ttlMs,
        extend: true, // the pre-fix setting, driven explicitly rather than off the real config
        pokeEveryMs: delayMs,
        forMs: delayMs * 6,
      });

      expect(dispatchedAt).toEqual([]);
    });
  });

  describe("given the dedup window is longer than the debounce", () => {
    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("keeps the key alive until the job it names has dispatched", () => {
      const { delayMs, deduplication } = reportUsageForMonthDispatchOptions;
      // Otherwise the key expires first and a second job stages for a window
      // the first is still serving.
      expect(deduplication.ttlMs).toBeGreaterThan(delayMs);
    });
  });

  describe("given the declared options themselves", () => {
    it("never extends the dedup window", () => {
      expect(reportUsageForMonthDispatchOptions.deduplication.extend).toBe(false);
    });

    it("builds the dedup id by rendering the command's own group key, not by hand-concatenating a string", () => {
      const params = { organizationId: "org-1", billingMonth: "2026-02" };
      const id = reportUsageForMonthDispatchOptions.deduplication.makeId(params);
      expect(id).toBe(renderGroupKey(reportUsageForMonthGroupKey(params)));
    });

    it("scopes the group key to the organization and billing month together", () => {
      expect(reportUsageForMonthGroupKey({ organizationId: "org-1", billingMonth: "2026-02" })).toEqual({
        tenantId: "org-1",
        lane: { kind: "command", name: "reportUsageForMonth" },
        scope: { kind: "partition", parts: ["org-1", "2026-02"] },
      });
    });
  });
});
