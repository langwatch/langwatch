// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What happens to a comparison that keeps failing, and what it is allowed to
 * take down with it.
 *
 * The attempt ladder and the dead row are the only trace a comparison that
 * died leaves behind, and neither exists in the in-memory store the unit suite
 * drives — so every scenario here needs the real outbox, with the ladder the
 * process itself configures rather than the dispatcher's default.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";

import { createWatchHarness } from "./costRollupWatch.integration.harness";
import { agreedComparison } from "./costRollupWatch.integration.runtime";
import {
  NOW,
  TODAY,
  TOMORROW_NIGHT,
  TONIGHT,
  YESTERDAY,
  YESTERDAY_MS,
} from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-retry" });

describe("retrying a comparison that fails", () => {
  beforeEach(() => {
    h.compareWith(h.compareAndFail);
  });

  describe("given a comparison that failed on each of its first three attempts", () => {
    /** @scenario A comparison that has failed three times is attempted a fourth */
    it("attempts it a fourth time", async () => {
      await h.record(h.charge());
      await h.runDueCheck();

      await h.drainThroughRetries({ passes: 3 });
      expect(h.daysComparedFor()).toHaveLength(3);

      await h.drainThroughRetries({ passes: 1 });

      expect(h.daysComparedFor()).toEqual([TODAY, TODAY, TODAY, TODAY]);
      const [message] = await h.messagesFor();
      expect(message?.status).toBe("pending");
    });
  });

  describe("given a comparison that failed on each of its first five attempts", () => {
    /** @scenario A comparison that has failed five times is not attempted again */
    it("stops at five and records that it gave up", async () => {
      await h.record(h.charge());
      await h.runDueCheck();

      await h.drainThroughRetries({ passes: 5 });
      expect(h.daysComparedFor()).toHaveLength(5);

      // Two further passes, each well past any backoff the ladder can ask for.
      await h.drainThroughRetries({ passes: 2 });

      expect(h.daysComparedFor()).toHaveLength(5);
      const [message] = await h.messagesFor();
      expect(message?.status).toBe("dead");
      // The record that a comparison died, which is the only trace it leaves.
      const attempts = await prisma.processManagerOutboxAttempt.findMany({
        where: { projectId: h.tenant },
        orderBy: { attempt: "asc" },
      });
      expect(attempts.map((attempt) => attempt.outcome)).toEqual([
        "retry_scheduled",
        "retry_scheduled",
        "retry_scheduled",
        "retry_scheduled",
        "dead",
      ]);
    });
  });

  describe("given a comparison that fails every time it is attempted", () => {
    /** @scenario A failing comparison does not stop charges being recorded */
    it("keeps recording charges and marking their days", async () => {
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainThroughRetries({ passes: 6 });
      expect((await h.messagesFor())[0]?.status).toBe("dead");

      h.clock = TONIGHT + 3_600_000;
      await h.record(h.charge({ occurredAtMs: NOW }));
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TOMORROW_NIGHT);
      expect(instance?.nextWakeAt).toBe(TOMORROW_NIGHT);
    });
  });

  describe("given a comparison for a day that gave up after its last attempt", () => {
    /** @scenario A comparison that gave up is not picked up by a later check */
    it("leaves that day uncompared at the next check", async () => {
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainThroughRetries({ passes: 6 });
      expect((await h.messagesFor())[0]?.status).toBe("dead");

      // Whatever was wrong is over, and a charge lands on a DIFFERENT day.
      h.compareWith(async (params) => agreedComparison(params));
      h.forgetComparisons();
      h.clock = TONIGHT + 3_600_000;
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));
      await h.runDueCheck();
      await h.drainOutbox();

      // A known gap, stated rather than hidden: the dead day is only
      // re-checked if something new lands on it.
      expect(h.daysComparedFor()).toEqual([YESTERDAY]);
    });
  });
});
