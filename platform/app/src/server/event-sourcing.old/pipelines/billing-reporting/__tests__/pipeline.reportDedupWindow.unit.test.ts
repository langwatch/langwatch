/**
 * Regression: a continuously-poked organization must still get its usage
 * report.
 *
 * The defect this guards is not "a flag is missing" — it is a dynamic. The
 * stage script re-scores an already-staged job to `occurredAt + delay` on every
 * squash unless the dedup declines to extend, and jobs dispatch only once their
 * score is in the past. So an organization whose projects never stop producing
 * billable events pushes its own report five minutes further out every time a
 * poke lands, and the report never comes due. The organizations with the most
 * billable traffic are the ones with the largest invoices.
 *
 * The model below is the stage script's dedup branch and nothing else, lifted
 * from the three places that decide the behaviour:
 *
 *   - `queues/groupQueue/groupQueue.ts` (`send`)
 *       `dispatchAfterMs = score + delay`, `shouldExtend = dedup.extend !== false`
 *   - `services/queues/queueManager.ts`
 *       a command's `scoreFn` is `payload.occurredAt`, and both the poke and
 *       the sweep pass `occurredAt: now()`
 *   - `queues/groupQueue/scripts.ts` (STAGE)
 *       on a squash of a still-staged job: `ZADD groupJobsKey dispatchAfter
 *       existingJobId` when extending, then `SET dedupKey ... PX dedupTtlMs`
 *       either way; and dispatch is `ZRANGEBYSCORE jobsKey -inf nowMs`
 *
 * The debounce and dedup configuration are read off the real pipeline rather
 * than restated here, so reverting the fix turns the first test red. The second
 * test drives the same model with the pre-fix setting and is what demonstrates
 * the starvation is real rather than assumed — if the model ever stopped
 * modelling it, that test would go green and say so.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { describe, expect, it } from "vitest";

import { createBillingReportingPipeline } from "../pipeline";

/**
 * One dedup id's worth of staging: at most one staged job, plus the dedup key
 * that points at it.
 */
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
      // Squash in place. The score moves only when the window extends.
      if (this.extend) {
        this.stagedScore = dispatchAfter;
      }
    } else {
      // No live key, or the job it named has already dispatched: stage fresh.
      this.stagedScore = dispatchAfter;
    }
    // The TTL is refreshed on every send, extending or not.
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

/**
 * Drives a continuously-poked organization for a stretch of wall clock.
 *
 * Staging happens before draining at each instant, which is the adversarial
 * ordering: it gives the poke every chance to postpone a report that is due
 * this very millisecond.
 */
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

function reportUsageForMonthOptions() {
  const pipeline = createBillingReportingPipeline({
    organizations: {} as never,
    billingCheckpoints: {} as never,
    getUsageReportingService: () => undefined,
    queryBillableEventsTotal: (async () => 0) as never,
    commands: { port: () => async () => undefined } as never,
    sweep: {
      listOrganizationsToReport: async () => [],
      deleteDispatchedBefore: async () => 0,
    },
  });

  const command = pipeline.commands.find(
    (cmd) => cmd.name === "reportUsageForMonth",
  );
  const deduplication = command?.options?.deduplication;
  if (!deduplication || typeof deduplication === "string") {
    throw new Error(
      "reportUsageForMonth is registered without an explicit deduplication config — the starvation model has nothing to read",
    );
  }
  return { delayMs: command?.options?.delay ?? 0, deduplication };
}

describe("reportUsageForMonth dedup window", () => {
  describe("given an organization poked inside every window, without a gap", () => {
    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("dispatches the usage report once per debounce window", () => {
      const { delayMs, deduplication } = reportUsageForMonthOptions();

      const dispatchedAt = pokeContinuously({
        delayMs,
        dedupTtlMs: deduplication.ttlMs ?? 0,
        extend: deduplication.extend !== false,
        // The poke's own dedup window is the same 5 minutes, so a project
        // ingesting continuously re-arms roughly this often — per pipeline it
        // is mounted on, which only makes the rate higher.
        pokeEveryMs: delayMs,
        forMs: delayMs * 6,
      });

      // The first report ran at the moment its own window closed, not later.
      expect(dispatchedAt[0]).toBe(delayMs);
      expect(dispatchedAt.length).toBeGreaterThanOrEqual(3);

      // And the reports keep coming: no gap grows without bound, which is the
      // property the starvation destroyed. The steady state is one report per
      // two windows — the window the key covers, then the window the next
      // poke's fresh stage waits out.
      const gaps = dispatchedAt
        .slice(1)
        .map((at, index) => at - (dispatchedAt[index] as number));
      for (const gap of gaps) {
        expect(gap).toBeLessThanOrEqual(delayMs * 2);
      }
    });

    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("never dispatches at all when the window is allowed to extend", () => {
      const { delayMs, deduplication } = reportUsageForMonthOptions();

      const dispatchedAt = pokeContinuously({
        delayMs,
        dedupTtlMs: deduplication.ttlMs ?? 0,
        // The pre-fix setting: `extend` unset, which the queue reads as true.
        extend: true,
        pokeEveryMs: delayMs,
        forMs: delayMs * 6,
      });

      expect(dispatchedAt).toEqual([]);
    });
  });

  describe("given the dedup window is longer than the debounce", () => {
    /** @scenario "A continuously busy organization still gets its report on schedule" */
    it("keeps the key alive until the job it names has dispatched", () => {
      const { delayMs, deduplication } = reportUsageForMonthOptions();

      // Otherwise the key expires first and a second job stages for a window
      // the first is still serving.
      expect(deduplication.ttlMs ?? 0).toBeGreaterThan(delayMs);
    });
  });
});
