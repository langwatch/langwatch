import { describe, expect, it } from "vitest";
import {
  pilotDefinition,
  pilotEvent,
  T0,
} from "../../__tests__/helpers/pilotProcess.fixture";
import { ProcessManagerService } from "../../processManagerService";
import { InMemoryProcessStore } from "../inMemoryProcessStore";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("InMemoryProcessStore outbox retention", () => {
  describe("when deleteDispatchedBefore runs against a mixed outbox", () => {
    it("removes only dispatched rows older than the cutoff and keeps pending work leasable", async () => {
      const store = new InMemoryProcessStore();
      const service = new ProcessManagerService({
        definition: pilotDefinition,
        store,
      });

      // Distinct turnIds: the outbox dedups on (processName, projectId,
      // messageKey), and the pilot's messageKey embeds the turnId.
      // Row 1: dispatched long before the cutoff — should be pruned.
      await service.handleEvent({
        envelope: pilotEvent({
          processKey: "conv_old",
          payload: { turnId: "turn_old" },
        }),
        now: T0,
      });
      const oldLease = (
        await store.leaseDueMessages({ now: T0, limit: 10, leaseDurationMs: 100 })
      )[0]!;
      await store.markDispatched({
        identity: oldLease,
        leaseToken: oldLease.leaseToken,
        now: T0,
      });

      // Row 2: dispatched after the cutoff — must survive.
      await service.handleEvent({
        envelope: pilotEvent({
          processKey: "conv_fresh",
          payload: { turnId: "turn_fresh" },
        }),
        now: T0 + 2 * DAY_MS,
      });
      const freshLease = (
        await store.leaseDueMessages({
          now: T0 + 2 * DAY_MS,
          limit: 10,
          leaseDurationMs: 100,
        })
      )[0]!;
      await store.markDispatched({
        identity: freshLease,
        leaseToken: freshLease.leaseToken,
        now: T0 + 2 * DAY_MS,
      });

      // Row 3: still pending — retention must never touch undelivered work.
      await service.handleEvent({
        envelope: pilotEvent({
          processKey: "conv_pending",
          payload: { turnId: "turn_pending" },
        }),
        now: T0 + 2 * DAY_MS,
      });

      const deleted = await store.deleteDispatchedBefore({
        processName: pilotDefinition.name,
        before: T0 + DAY_MS,
      });
      expect(deleted).toBe(1);

      const rerun = await store.deleteDispatchedBefore({
        processName: pilotDefinition.name,
        before: T0 + DAY_MS,
      });
      expect(rerun).toBe(0);

      const leasable = await store.leaseDueMessages({
        now: T0 + 2 * DAY_MS,
        limit: 10,
        leaseDurationMs: 100,
      });
      expect(leasable.map((message) => message.processKey)).toEqual([
        "conv_pending",
      ]);
    });
  });
});
