import { beforeEach, describe, expect, it } from "vitest";
import {
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
} from "../../__tests__/helpers/pilotProcess.fixture";
import { ProcessManagerService } from "../../processManagerService";
import { InMemoryProcessStore } from "../inMemoryProcessStore";

describe("InMemoryProcessStore lease fencing", () => {
  describe("given a committed outbox message", () => {
    let store: InMemoryProcessStore;

    beforeEach(async () => {
      store = InMemoryProcessStore.createForTesting();
      const service = new ProcessManagerService({
        definition: pilotDefinition,
        store,
      });
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "event-1" }),
        now: T0,
      });
    });

    describe("when the message is re-leased after its first lease lapses", () => {
      it("invalidates the expired worker token", async () => {
        const first = (
          await store.leaseDueMessages({
            now: T0,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        const second = (
          await store.leaseDueMessages({
            now: T0 + 100,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        expect(second.leaseToken).not.toBe(first.leaseToken);

        const identity = {
          processName: first.processName,
          projectId: first.projectId,
          messageKey: first.messageKey,
        };
        const fencedFail = await store.markFailed({
          identity,
          leaseToken: first.leaseToken,
          now: T0 + 101,
          nextAttemptAt: T0 + 1_000,
          dead: true,
        });
        const fencedDispatch = await store.markDispatched({
          identity,
          leaseToken: first.leaseToken,
          now: T0 + 102,
        });
        expect(fencedFail).toEqual({ applied: false });
        expect(fencedDispatch).toEqual({ applied: false });

        // Each lease counted one delivery start; the fenced acknowledgements
        // changed nothing.
        expect(await store.findMessagesByRef({ ref: pilotRef })).toEqual([
          expect.objectContaining({
            status: "pending",
            attempts: 2,
            leaseToken: second.leaseToken,
          }),
        ]);

        const applied = await store.markDispatched({
          identity,
          leaseToken: second.leaseToken,
          now: T0 + 103,
        });
        expect(applied).toEqual({ applied: true });
        expect(await store.findMessagesByRef({ ref: pilotRef })).toEqual([
          expect.objectContaining({
            status: "dispatched",
            attempts: 2,
            leaseToken: null,
          }),
        ]);
      });
    });

    describe("when a leased message is released un-attempted", () => {
      it("hands the attempt back and leaves the message immediately leasable", async () => {
        const leased = (
          await store.leaseDueMessages({
            now: T0,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        expect(leased.attempts).toBe(1);

        const identity = {
          processName: leased.processName,
          projectId: leased.projectId,
          messageKey: leased.messageKey,
        };
        const released = await store.releaseLease({
          identity,
          leaseToken: leased.leaseToken,
          now: T0 + 10,
        });
        expect(released).toEqual({ applied: true });

        // Immediately leasable again, and the released attempt was not
        // charged.
        const afterRelease = await store.findMessagesByRef({ ref: pilotRef });
        expect(afterRelease).toEqual([
          expect.objectContaining({
            status: "pending",
            attempts: 0,
            leaseToken: null,
          }),
        ]);
        const second = (
          await store.leaseDueMessages({
            now: T0 + 11,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        expect(second.attempts).toBe(1);

        // A stale release (token already superseded) is a no-op.
        const stale = await store.releaseLease({
          identity,
          leaseToken: leased.leaseToken,
          now: T0 + 12,
        });
        expect(stale).toEqual({ applied: false });
      });
    });
  });
});
