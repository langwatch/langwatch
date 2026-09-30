// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which day a charge marks, and which moment it arms the check for.
 *
 * The two halves of what the process decides on the way IN, kept together
 * because they are decided from the same field — the moment the charge
 * happened — and the ways they go wrong shade into each other: a day derived
 * from the arrival time, and a check armed from the business time, are the
 * same off-by-one field read twice.
 *
 * What a due check then does with those marks is next door, in
 * `costRollupWatch.checks.unit.test.ts`.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createWatchHarness,
  LAST_TUESDAY,
  LAST_TUESDAY_MS,
  NOW,
  TODAY,
  TONIGHT,
  YESTERDAY,
  YESTERDAY_MS,
} from "./costRollupWatch.unit.harness";

const h = createWatchHarness({ tenantPrefix: "cost-watch-marking" });

describe("marking the day a charge happened on", () => {
  describe("given an organization with no check armed", () => {
    /** @scenario The first charge of a day marks that day and arms a check */
    it("marks the charge's own day and arms the next slot after it", async () => {
      await h.record(h.charge());

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
      expect(instance?.nextWakeAt).toBe(TONIGHT);
    });

    /** @scenario A correction that arrives before the charge it corrects still marks its day */
    it("marks an old day from a retraction that arrives first, and only once", async () => {
      await h.record(
        h.charge({
          eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
          occurredAtMs: Date.UTC(2026, 8, 1, 13, 0, 0),
        }),
      );
      await h.record(h.charge({ occurredAtMs: LAST_TUESDAY_MS }));

      expect((await h.stateOf()).pendingDays).toEqual([LAST_TUESDAY]);
    });
  });

  describe("given a pulled charge dated today has already been recorded", () => {
    beforeEach(async () => {
      await h.record(h.charge());
    });

    /** @scenario A second charge on the same day neither marks it twice nor moves the check */
    it("keeps one mark and leaves the armed moment alone", async () => {
      h.clock = NOW + 3_600_000;
      await h.record(h.charge({ occurredAtMs: NOW + 3_600_000 }));

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
      expect(instance?.nextWakeAt).toBe(TONIGHT);
    });

    /** @scenario Charges on two different days mark both and still share one check */
    it("marks both days under the one armed check", async () => {
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });

    /** @scenario The same charge delivered twice changes nothing */
    it("ignores a redelivery of the very same charge", async () => {
      const repeat = h.charge({ eventId: `evt-repeat-${h.ns}` });
      await h.record(repeat);
      const before = await h.instanceOf();

      await h.record(repeat);

      const after = await h.instanceOf();
      expect(after?.state.pendingDays).toEqual([TODAY]);
      expect(after?.state.armedAt).toBe(TONIGHT);
      expect(after?.revision).toBe(before?.revision);
    });
  });

  describe("given the organization's charges for last Tuesday were checked and cleared", () => {
    beforeEach(async () => {
      await h.record(h.charge({ occurredAtMs: LAST_TUESDAY_MS }));
      await h.runDueCheck();
    });

    /** @scenario A correction dated an old day puts that old day back on the list */
    it("puts the corrected day back on the list", async () => {
      await h.record(
        h.charge({
          eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
          occurredAtMs: LAST_TUESDAY_MS,
        }),
      );

      expect((await h.stateOf()).pendingDays).toEqual([LAST_TUESDAY]);
    });

    /** @scenario A charge after the check arms the next one */
    it("arms the next check when a new charge lands", async () => {
      await h.record(h.charge({ occurredAtMs: h.clock }));

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toHaveLength(1);
      expect(instance?.state.armedAt).not.toBeNull();
      expect(instance?.nextWakeAt).not.toBeNull();
    });
  });
});

describe("choosing the moment a check is armed for", () => {
  describe("given a charge recorded a minute before the slot", () => {
    /** @scenario A charge landing a minute before the slot is checked at that slot */
    it("arms that same day's slot", async () => {
      h.clock = Date.UTC(2026, 8, 10, 4, 22, 0);
      await h.record(h.charge({ occurredAtMs: h.clock }));

      expect((await h.stateOf()).armedAt).toBe(Date.UTC(2026, 8, 10, 4, 23, 0));
    });
  });

  describe("given a charge recorded exactly on the slot", () => {
    /** @scenario A charge landing exactly on the slot waits for tomorrow */
    it("arms tomorrow's slot rather than one already due", async () => {
      h.clock = Date.UTC(2026, 8, 10, 4, 23, 0);
      await h.record(h.charge({ occurredAtMs: h.clock }));

      const armedAt = (await h.stateOf()).armedAt;
      expect(armedAt).toBe(Date.UTC(2026, 8, 11, 4, 23, 0));
      expect(armedAt).toBeGreaterThan(h.clock);
    });
  });

  describe("given a charge recorded just after the slot", () => {
    /** @scenario A charge landing just after the slot waits for tomorrow */
    it("arms tomorrow's slot", async () => {
      h.clock = Date.UTC(2026, 8, 10, 4, 24, 0);
      await h.record(h.charge({ occurredAtMs: h.clock }));

      expect((await h.stateOf()).armedAt).toBe(Date.UTC(2026, 8, 11, 4, 23, 0));
    });
  });

  describe("given a charge dated three days from now", () => {
    /** @scenario A charge dated in the future does not pull an armed check earlier */
    it("marks the future day and leaves tonight's check where it is", async () => {
      await h.record(h.charge());

      await h.record(h.charge({ occurredAtMs: NOW + 3 * 86_400_000 }));

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, "2026-09-13"]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });

    /** @scenario A charge dated in the future does not push the check out to that date */
    it("arms the next slot after now rather than one after the future date", async () => {
      await h.record(h.charge({ occurredAtMs: NOW + 3 * 86_400_000 }));

      const armedAt = (await h.stateOf()).armedAt;
      expect(armedAt).toBe(TONIGHT);
      expect(armedAt).toBeLessThan(NOW + 3 * 86_400_000);
    });
  });

  describe("given a charge carrying no usable moment", () => {
    /** @scenario A charge carrying no usable moment is refused rather than marked */
    it.each([
      ["a missing moment", undefined],
      ["a moment that is not a date", "yesterday"],
      ["a moment that is not a number", Number.NaN],
    ])("refuses %s and leaves the state as it was", async (_label, value) => {
      await h.record(h.charge());
      const before = await h.instanceOf();

      await h.record(h.charge({ occurredAtMs: value }));

      const after = await h.instanceOf();
      expect(after?.state.pendingDays).toEqual(before?.state.pendingDays);
      expect(after?.state.armedAt).toBe(TONIGHT);
      expect(after?.nextWakeAt).toBe(TONIGHT);
    });
  });
});
