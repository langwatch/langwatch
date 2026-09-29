// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a due check asks for, who it belongs to, and the invariant that makes
 * silence distinguishable from breakage.
 *
 * The way IN — which day a charge marks and which moment it arms — is next
 * door, in `costRollupWatch.marking.unit.test.ts`.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createWatchHarness,
  NOW,
  TODAY,
  TONIGHT,
  YESTERDAY,
  YESTERDAY_MS,
} from "./costRollupWatch.unit.harness";

const h = createWatchHarness({ tenantPrefix: "cost-watch-checks" });

describe("running the check when it comes due", () => {
  describe("given two days are marked as needing a check", () => {
    beforeEach(async () => {
      await h.record(h.charge());
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));
    });

    /** @scenario A due check asks for one comparison per marked day */
    it("asks for one comparison per marked day, naming the organization and lane", async () => {
      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.compareDay).toHaveBeenCalledTimes(2);
      expect(h.compareDay.mock.calls.map(([params]) => params)).toEqual([
        {
          tenantId: h.TENANT,
          day: TODAY,
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        },
        {
          tenantId: h.TENANT,
          day: YESTERDAY,
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        },
      ]);
    });

    /** @scenario A due check clears the marks and disarms */
    it("clears the marks and leaves nothing armed", async () => {
      await h.runDueCheck();

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([]);
      expect(instance?.state.armedAt).toBeNull();
      expect(instance?.nextWakeAt).toBeNull();
    });
  });

  describe("given a day was compared at tonight's check", () => {
    /** @scenario A charge re-marking a day after tonight's check still gets that day compared again */
    it("compares that day a second time when a charge marks it again", async () => {
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();
      expect(h.compareDay).toHaveBeenCalledTimes(1);

      // The skew this exists for: the charge carries a moment before the
      // check's own, so it arms the moment that has just gone by, yet it is
      // written after the check ran. Driven through `record` rather than
      // written into the store, so what arms it is the process's own marking.
      await h.record(h.charge({ occurredAtMs: NOW }), { now: TONIGHT - 1 });
      expect((await h.stateOf()).armedAt).toBe(TONIGHT);

      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.compareDay.mock.calls.map(([params]) => params.day)).toEqual([
        TODAY,
        TODAY,
      ]);
      const cleared = await h.instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.state.armedAt).toBeNull();
      expect(cleared?.nextWakeAt).toBeNull();
    });
  });

  describe("given no days are marked as needing a check", () => {
    /** @scenario A check that comes due with nothing marked asks for no comparison */
    it("asks for no comparison", async () => {
      await h.store.commit({
        ref: h.refFor(h.TENANT),
        tenantId: h.TENANT,
        state: { pendingDays: [], armedAt: TONIGHT, marks: 0 },
        expectedRevision: 0,
        nextWakeAt: TONIGHT,
        sourceEventId: `armed-empty-${h.ns}`,
        messages: [],
        now: NOW,
      });

      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.compareDay).not.toHaveBeenCalled();
    });
  });

  describe("given a source read from scratch that covers a year of bills", () => {
    /** @scenario A first import marks every day it covers and compares them at one check */
    it("marks every distinct day once and compares them all at the one check", async () => {
      const firstDay = Date.UTC(2025, 8, 11, 12, 0, 0);
      const days = 365;
      for (let offset = 0; offset < days; offset++) {
        // Two charges per day, so the day being a set is what collapses them
        // rather than there only ever having been one.
        await h.record(
          h.charge({ occurredAtMs: firstDay + offset * 86_400_000 }),
        );
        await h.record(
          h.charge({
            occurredAtMs: firstDay + offset * 86_400_000 + 3_600_000,
          }),
        );
      }

      const armed = await h.instanceOf();
      expect(armed?.state.pendingDays).toHaveLength(days);
      expect(new Set(armed?.state.pendingDays).size).toBe(days);
      expect(armed?.state.armedAt).toBe(TONIGHT);

      await h.runDueCheck();
      await h.drainOutbox(6);

      expect(h.compareDay).toHaveBeenCalledTimes(days);
    });
  });
});

describe("keeping one check per organization", () => {
  describe("given charges from two different bills of one organization", () => {
    /** @scenario Every charge of one organization feeds the same check */
    it("gathers both onto one instance with both days marked", async () => {
      await h.record(h.charge({ aggregateId: `item-a-${h.ns}` }));
      await h.record(
        h.charge({
          aggregateId: `item-b-${h.ns}`,
          occurredAtMs: YESTERDAY_MS,
        }),
      );

      const instance = await h.instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });
  });

  describe("given two organizations that both pull their bills", () => {
    /** @scenario One organization's charges never mark another's days */
    it("leaves the other organization with nothing marked and nothing armed", async () => {
      await h.record(h.charge({ tenantId: h.TENANT }));

      expect(await h.instanceOf(h.OTHER_TENANT)).toBeNull();
    });
  });
});

describe("keeping marked days answerable", () => {
  describe("given any organization with at least one day marked", () => {
    /** @scenario An organization holding marked days always has a check armed */
    it("always holds a check armed alongside them", async () => {
      const moments = [
        NOW,
        Date.UTC(2026, 8, 10, 4, 23, 0),
        Date.UTC(2026, 8, 1, 9, 0, 0),
        NOW + 3 * 86_400_000,
      ];
      for (const occurredAtMs of moments) {
        h.clock = Math.min(occurredAtMs, NOW);
        await h.record(h.charge({ occurredAtMs }));
        const instance = await h.instanceOf();
        if ((instance?.state.pendingDays.length ?? 0) > 0) {
          expect(instance?.state.armedAt).not.toBeNull();
          expect(instance?.nextWakeAt).not.toBeNull();
        }
      }

      await h.runDueCheck();
      const cleared = await h.instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.state.armedAt).toBeNull();
    });
  });
});
