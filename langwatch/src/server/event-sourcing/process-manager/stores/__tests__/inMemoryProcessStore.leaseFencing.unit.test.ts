import { describe, expect, it } from "vitest";
import {
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
} from "../../__tests__/helpers/pilotProcess.fixture";
import { ProcessManagerService } from "../../processManagerService";
import { InMemoryProcessStore } from "../inMemoryProcessStore";

describe("InMemoryProcessStore lease fencing", () => {
  it("invalidates the expired worker token when a message is re-leased", async () => {
    const store = new InMemoryProcessStore();
    const service = new ProcessManagerService({
      definition: pilotDefinition,
      store,
    });
    await service.handleEvent({
      envelope: pilotEvent({ eventId: "event-1" }),
      now: T0,
    });

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
    await store.markFailed({
      identity,
      leaseToken: first.leaseToken,
      now: T0 + 101,
      nextAttemptAt: T0 + 1_000,
      dead: true,
    });
    await store.markDispatched({
      identity,
      leaseToken: first.leaseToken,
      now: T0 + 102,
    });

    expect(await store.findMessagesByRef({ ref: pilotRef })).toEqual([
      expect.objectContaining({
        status: "pending",
        attempts: 0,
        leaseToken: second.leaseToken,
      }),
    ]);

    await store.markDispatched({
      identity,
      leaseToken: second.leaseToken,
      now: T0 + 103,
    });
    expect(await store.findMessagesByRef({ ref: pilotRef })).toEqual([
      expect.objectContaining({
        status: "dispatched",
        attempts: 1,
        leaseToken: null,
      }),
    ]);
  });
});
