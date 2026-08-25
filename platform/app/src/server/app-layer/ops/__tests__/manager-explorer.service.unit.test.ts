import type { ProcessStore } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManagerExplorerService } from "../manager-explorer.service";
import { NullProcessAuditSink } from "../process-audit.repository";
import { NullProcessOpsRepository } from "../repositories/process-ops.repository";

vi.mock("~/server/event-sourcing/registration/pipelineRegistry", () => ({
  getProcessManagerMetadata: vi.fn(),
}));

const makeService = (store: ProcessStore) =>
  new ManagerExplorerService({
    store,
    fleet: new NullProcessOpsRepository(),
    audit: new NullProcessAuditSink(),
  });

import { getProcessManagerMetadata } from "~/server/event-sourcing/registration/pipelineRegistry";

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

const metadataMock = vi.mocked(getProcessManagerMetadata);

function fakeStore(
  overrides: {
    findByRef?: () => Promise<unknown>;
    findMessagesByRef?: () => Promise<unknown[]>;
  } = {},
): ProcessStore {
  return {
    findByRef: vi.fn(async () => null),
    hasConsumedSource: vi.fn(async () => false),
    findMessagesByRef: vi.fn(async () => []),
    commit: vi.fn(),
    leaseDueMessages: vi.fn(),
    markDispatched: vi.fn(),
    markFailed: vi.fn(),
    findDueWakes: vi.fn(),
    deleteDispatchedBefore: vi.fn(),
    requeueDeadMessages: vi.fn().mockResolvedValue(3),
    ...overrides,
  } as unknown as ProcessStore;
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
        const store = fakeStore();
        const service = makeService(store);

        await service.getForAggregate({
          aggregateType: "trigger",
          projectId: "project-1",
          aggregateId: "trigger-42",
        });

        expect(store.findByRef).toHaveBeenCalledWith({
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
      const store = fakeStore();
      const service = makeService(store as never);
      const result = await service.requeueDeadMessages({
        processName: "webhookDelivery",
        projectId: "project-1",
        processKey: "endpoint:whep_1",
        messageKeyPrefix: "send:whep_1:",
        requestedBy: "user_ops",
      });
      expect(result).toEqual({ requeued: 3 });
      expect(store.requeueDeadMessages).toHaveBeenCalledWith(
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
