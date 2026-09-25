import { InMemoryProcessStore, type ProcessStore } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpsEventingIntrospection, OpsProcessManagerMetadata } from "../../app/ops.app.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryProcessAuditRepository } from "../../repositories/memory/memory.process-audit.repository.ts";
import { MemoryProcessOpsRepository } from "../../repositories/memory/memory.process-ops.repository.ts";
import { ManagerExplorerService } from "../manager-explorer.service.ts";

const metadataMock = vi.fn<() => OpsProcessManagerMetadata[]>(() => []);

class FakeIntrospection implements OpsEventingIntrospection {
  killSwitches(): never[] {
    return [];
  }

  projections(): never[] {
    return [];
  }

  processManagers(): OpsProcessManagerMetadata[] {
    return metadataMock();
  }

  dejaViewProjections(): never[] {
    return [];
  }
}

const makeService = (store: ProcessStore) =>
  ManagerExplorerService.create({
    store,
    fleet: MemoryProcessOpsRepository.create({ store: MemoryOpsStore.create() }),
    audit: MemoryProcessAuditRepository.create({ store: MemoryOpsStore.create() }),
    introspection: new FakeIntrospection(),
  });

const perAggregate = {
  processName: "triggerSettlement",
  pipelineName: "automations",
  aggregateType: "trigger",
  eventTypes: ["trigger.matchRecorded"] as const,
  intentTypes: ["persist", "notify"],
  scheduled: false,
  everyMs: null,
  hasWake: true,
};

const scheduledSingleton = {
  processName: "graphAlertSweep",
  pipelineName: "automations",
  aggregateType: "trigger",
  eventTypes: [] as const,
  intentTypes: [],
  scheduled: true,
  everyMs: 30_000,
  hasWake: true,
};

const otherAggregate = {
  processName: "langyConversation",
  pipelineName: "langy",
  aggregateType: "langy_conversation",
  eventTypes: [] as const,
  intentTypes: [],
  scheduled: false,
  everyMs: null,
  hasWake: false,
};

/** The eventing memory twin, with the reads a test scripts laid over it. */
function fakeStore(
  overrides: {
    findByRef?: () => Promise<unknown>;
    findMessagesByRef?: () => Promise<unknown[]>;
    requeueDeadMessages?: () => Promise<unknown>;
  } = {},
): ProcessStore {
  return Object.assign(InMemoryProcessStore.createForTesting(), overrides);
}

describe("ManagerExplorerService", () => {
  beforeEach(() => {
    metadataMock.mockReset();
  });

  describe("given managers of mixed kinds share an aggregate type", () => {
    describe("when the aggregate's managers are requested", () => {
      it("returns only the per-aggregate machines, not scheduled singletons or other types", async () => {
        metadataMock.mockReturnValue([perAggregate, scheduledSingleton, otherAggregate]);
        const service = makeService(fakeStore());

        const result = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(result.map((m) => m.processName)).toEqual(["triggerSettlement"]);
      });
    });
  });

  describe("given a per-aggregate manager", () => {
    describe("when its instance is read", () => {
      it("keys the store by processName + projectId + aggregateId", async () => {
        metadataMock.mockReturnValue([perAggregate]);
        // Captured before it's attached to the ProcessStore-typed mock: the
        // interface declares findByRef with method shorthand (generic, so it
        // can't be converted to a property without a variance risk to a
        // package outside this lane's scope), and asserting on `store.findByRef`
        // directly would extract that method unbound.
        const findByRef = vi.fn(async () => null);
        const service = makeService(fakeStore({ findByRef }));

        await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(findByRef).toHaveBeenCalledWith({
          ref: {
            processName: "triggerSettlement",
            projectId: "project-1",
            processKey: "trigger-42",
          },
        });
      });
    });
  });

  describe("given the machine has never started for this aggregate", () => {
    describe("when it is read", () => {
      it("reports a null instance rather than fabricating state", async () => {
        metadataMock.mockReturnValue([perAggregate]);
        const service = makeService(fakeStore({ findByRef: vi.fn(async () => null) }));

        const [manager] = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(manager?.instance).toBeNull();
      });
    });
  });

  describe("given a running machine with an emitted intent", () => {
    describe("when it is read", () => {
      it("surfaces the current position and the emitted command", async () => {
        metadataMock.mockReturnValue([perAggregate]);
        const service = makeService(
          fakeStore({
            findByRef: vi.fn(async () => ({
              ref: {
                processName: "triggerSettlement",
                projectId: "project-1",
                processKey: "trigger-42",
              },
              tenantId: "project-1",
              state: { pendingMatches: {}, overflowFlushed: 0 },
              revision: 3,
              nextWakeAt: 1_800_000_000_000,
              updatedAt: 1_700_000_000_000,
            })),
            findMessagesByRef: vi.fn(async () => [
              {
                messageKey: "k1",
                intentType: "persist",
                payload: {},
                traceCarrier: {},
                processName: "triggerSettlement",
                projectId: "project-1",
                processKey: "trigger-42",
                tenantId: "project-1",
                sourceEventId: "evt-1",
                status: "dispatched" as const,
                attempts: 1,
                nextAttemptAt: 0,
                leaseToken: null,
                createdAt: 1_700_000_000_000,
              },
            ]),
          }),
        );

        const [manager] = await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(manager?.instance?.revision).toBe(3);
        expect(manager?.outbox).toHaveLength(1);
        expect(manager?.outbox[0]).toMatchObject({
          intentType: "persist",
          status: "dispatched",
          sourceEventId: "evt-1",
        });
      });
    });
  });
});

describe("given dead outbox messages for one endpoint stream", () => {
  describe("when the operator requeues them", () => {
    it("forwards the scope and prefix, stamps now, and returns the count", async () => {
      // Captured before it's attached to the ProcessStore-typed mock — see
      // the findByRef test above for why.
      const requeueDeadMessages = vi.fn().mockResolvedValue(3);
      const store = fakeStore({ requeueDeadMessages });
      const service = makeService(store);
      const result = await service.requeueDeadMessages({
        processName: "webhookDelivery",
        projectId: "project-1",
        processKey: "endpoint:whep_1",
        messageKeyPrefix: "send:whep_1:",
        requestedBy: "user_ops",
      });
      expect(result).toEqual({ requeued: 3 });
      expect(requeueDeadMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: "webhookDelivery",
          projectId: "project-1",
          processKey: "endpoint:whep_1",
          messageKeyPrefix: "send:whep_1:",
          now: expect.any(Number),
        }),
      );
    });
  });
});
