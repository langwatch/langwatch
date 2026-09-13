// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The two ways a check and the clock get out of step: a charge landing while
 * the check is already running, and a check whose moment went by with nothing
 * running to answer it.
 *
 * Both need the real substrate rather than the in-memory store the unit suite
 * drives. The revision fence is what makes the losing side of the race retry
 * instead of standing down holding a day nobody will ask about again, and the
 * wake is only overdue in the sense Postgres can be asked about.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { describe, expect, it } from "vitest";
import { COST_ROLLUP_WATCH_PROCESS_NAME } from "../costRollupWatch.process";
import { createWatchHarness } from "./costRollupWatch.integration.harness";
import {
  TODAY,
  TONIGHT,
  YESTERDAY,
  YESTERDAY_MS,
} from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-race" });

describe("a charge and a check racing each other", () => {
  describe("given a day marked and its check already due", () => {
    /** @scenario A charge arriving while the check is running is not lost */
    it("retries the losing side and compares both days", async () => {
      await h.record(h.charge());
      const armed = await h.instanceOf();
      // The wake the machinery picked up, captured at the revision it was
      // scheduled at — the state the losing side of the race holds.
      const inFlight = {
        ref: h.refFor(),
        revision: armed!.revision,
        wakeAt: armed!.nextWakeAt!,
      };

      h.clock = TONIGHT;
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));
      const result = await h.handleWake(inFlight);

      // It stood down without asking for anything — and, crucially, without
      // clearing the marks it was holding. `staleWake` is what the runtime
      // calls standing down: a wake is only valid at the revision it was
      // scheduled at, and the charge that landed meanwhile moved it.
      expect(result.outcome).toBe("staleWake");
      await h.drainOutbox();
      expect(h.daysComparedFor()).toEqual([]);

      // The instance is still armed at a moment that has passed, so the next
      // pass of the machinery picks it up and compares both days at once.
      await h.sweepDueChecks();
      await h.drainOutbox();

      expect(h.daysComparedFor().sort()).toEqual([YESTERDAY, TODAY]);
      const cleared = await h.instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.nextWakeAt).toBeNull();
    });
  });
});

describe("answering a check that was missed", () => {
  describe("given a check whose moment passed with nothing running", () => {
    /** @scenario A check whose moment passed with nothing running fires once afterwards */
    it("answers it once, however many slots went by", async () => {
      await h.record(h.charge());
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));

      // Three nights later. Nothing answered any of them.
      h.clock = TONIGHT + 3 * 86_400_000;
      await h.sweepDueChecks();
      await h.drainOutbox();
      await h.sweepDueChecks();
      await h.drainOutbox();

      // One comparison per marked day, not one per slot that went by.
      expect(h.daysComparedFor().sort()).toEqual([YESTERDAY, TODAY]);
      expect(await h.messagesFor()).toHaveLength(2);
      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([]);
      expect(instance?.nextWakeAt).toBeNull();
    });
  });

  describe("given a check whose moment passed and which has not been answered", () => {
    /** @scenario A check that is overdue is visible without anyone knowing to look */
    it("is reported as overdue when the state of checks is read", async () => {
      await h.record(h.charge());
      const overdueBy = 6 * 3_600_000;
      h.clock = TONIGHT + overdueBy;

      const due = await h.store.findDueWakes({
        now: h.clock,
        limit: 200,
        processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
      });

      const mine = due.find((wake) => wake.ref.projectId === h.tenant);
      if (!mine) throw new Error("the overdue check was not reported as due");
      // Overdue is the check's own moment sitting behind the present, read
      // straight off the substrate rather than off a second surface.
      expect(h.clock - mine.wakeAt).toBe(overdueBy);

      // And how late it was is recorded when it is finally answered.
      const before = await h.wakeLag();
      await h.sweepDueChecks();
      const after = await h.wakeLag();
      expect(after.count).toBeGreaterThan(before.count);
      expect(after.sumMs - before.sumMs).toBeGreaterThanOrEqual(overdueBy);
    });
  });
});
