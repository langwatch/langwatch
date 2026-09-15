// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What identifies one comparison, and therefore which deliveries are the same
 * question asked twice and which are a new one.
 *
 * Only the real outbox can answer this: uniqueness is on
 * `(processName, projectId, messageKey)`, so the key the runtime writes is
 * what makes a redelivered check slot compare a day once, and what makes a day
 * marked again at a later slot compare it a second time. The drift counter is
 * asserted alongside the runs because a repeat of a read-only comparison is
 * otherwise invisible while it doubles the number we report.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { describe, expect, it } from "vitest";

import { COST_ROLLUP_WATCH_MAX_ATTEMPTS } from "../costRollupWatch.process";
import { createWatchHarness } from "./costRollupWatch.integration.harness";
import {
  NOW,
  TODAY,
  TOMORROW_NIGHT,
  TONIGHT,
} from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-slot" });

describe("recognising a repeat of one check slot", () => {
  describe("given a day compared at last night's check", () => {
    /** @scenario The same check slot delivered twice compares a day only once */
    it("compares the day once and raises the drift count once", async () => {
      h.compareWith(h.compareForReal);
      await h.appendObserved({ costNanoMinor: 5_000_000_000 });
      await h.writeSummary({ amountNanoMinor: 9_999_000_000 });
      await h.record(h.charge());
      await h.runDueCheck();
      // Through the whole ladder, so the drift is actually reported once: a
      // count taken before the last look would be unchanged either way, and
      // the assertion at the end of this test would then hold whether or not
      // the replay reported a second time.
      await h.drainThroughRetries({ passes: COST_ROLLUP_WATCH_MAX_ATTEMPTS });
      const driftAfterFirst = await h.mismatchCount();
      // One entry per look, all of them the same day: the ladder asks again,
      // it does not ask about something else.
      const everyLook = Array<string>(COST_ROLLUP_WATCH_MAX_ATTEMPTS).fill(
        TODAY,
      );
      expect(h.daysComparedFor()).toEqual(everyLook);

      // The redelivery this design expects: the slot comes round again — a
      // check that ran and crashed before being recorded as done — so the
      // same day is asked for at the same slot a second time. The mark
      // counter is carried over from the state the check left behind, which
      // is what makes this a repeat of that check rather than a new question:
      // nothing marked the day again in between.
      const compared = await h.instanceOf();
      const marks = compared!.state.marks;
      await h.store.commit({
        ref: h.refFor(),
        tenantId: h.tenant,
        state: { pendingDays: [TODAY], armedAt: TONIGHT, marks },
        expectedRevision: compared!.revision,
        nextWakeAt: TONIGHT,
        sourceEventId: null,
        messages: [],
        now: h.clock,
      });
      const replay = await h.runDueCheck();
      await h.drainOutbox();

      // The outbox recognised the key rather than inserting a second row.
      if (replay.outcome !== "committed") {
        throw new Error(`replayed wake did not commit: ${replay.outcome}`);
      }
      expect(replay.insertedMessageKeys).toEqual([]);
      expect(replay.duplicateMessageKeys).toEqual([
        h.outboxKey(`compare:${TODAY}:${TONIGHT}:${marks}`),
      ]);
      expect(h.daysComparedFor()).toEqual(everyLook);
      // Asserted alongside the run because a second pass of a read-only
      // comparison is otherwise invisible while it doubles what we report.
      expect(await h.mismatchCount()).toBe(driftAfterFirst);
    });
  });

  describe("given a day marked again after its comparison", () => {
    /** @scenario A day marked again after its comparison is compared again at the next slot */
    it("compares it again at the next slot", async () => {
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();
      expect(h.daysComparedFor()).toEqual([TODAY]);

      h.clock = TONIGHT + 3_600_000;
      await h.record(h.charge({ occurredAtMs: NOW }));
      expect((await h.instanceOf())?.state.armedAt).toBe(TOMORROW_NIGHT);

      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.daysComparedFor()).toEqual([TODAY, TODAY]);
      // The slot and the mark counter are both part of what identifies a
      // comparison, so the second one is a new row rather than a repeat the
      // outbox would suppress: a new slot, and the day marked a second time.
      const keys = (await h.messagesFor())
        .map((message) => message.messageKey)
        .sort();
      expect(keys).toEqual(
        [
          h.outboxKey(`compare:${TODAY}:${TONIGHT}:1`),
          h.outboxKey(`compare:${TODAY}:${TOMORROW_NIGHT}:2`),
        ].sort(),
      );
    });
  });
});
