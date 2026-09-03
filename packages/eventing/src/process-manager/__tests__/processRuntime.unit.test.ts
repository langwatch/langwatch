import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { buildProcessManager } from "../../pipeline/processBuilder";
import { ProcessRuntime, SCHEDULED_SINGLETON_PROJECT_ID } from "../processRuntime";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";
import type { ProcessStore } from "../stores/processStore.types";

const tenantId = createTenantId("project-1");
const TEST_PROCESS_EVENT_TYPE = "test.process.triggered";
type ProcessTestEvent = Event<{ traceId: string }>;

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

/** A store stub that never has a persisted instance and always reports the
 * given commit outcome — used to force outcomes InMemoryProcessStore cannot
 * produce deterministically from a single synchronous call. */
function makeStubStore(overrides: Partial<ProcessStore> = {}): ProcessStore {
  return {
    findByRef: async () => null,
    hasConsumedSource: async () => false,
    commit: async () => {
      throw new Error("makeStubStore: commit not stubbed");
    },
    appendIntents: async () => ({
      insertedMessageKeys: [],
      duplicateMessageKeys: [],
    }),
    findMessagesByRef: async () => [],
    leaseDueMessages: async () => [],
    markDispatched: async () => ({ applied: true }),
    markFailed: async () => ({ applied: true }),
    recordFailedAttempt: async () => undefined,
    releaseLease: async () => ({ applied: true }),
    findDueWakes: async () => [],
    requeueDeadMessages: async () => 0,
    deleteDispatchedBefore: async () => 0,
    deleteDispatchedOutboxBatch: async () => 0,
    deleteDeadOutboxBatch: async () => 0,
    deleteConsumedInboxBatch: async () => 0,
    ...overrides,
  };
}

function physicalEvent(id: string): ProcessTestEvent {
  return {
    id,
    idempotencyKey: "trigger-1:trace-1:30000-0",
    aggregateId: "trigger-1",
    aggregateType: "trigger",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: TEST_PROCESS_EVENT_TYPE,
    version: "2026-07-18",
    data: { traceId: "trace-1" },
  };
}

describe("ProcessRuntime", () => {
  describe("given a process manager derives an operation key from its event", () => {
    it("persists the process under that key instead of the aggregate ID", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "operationInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .keyBy((event) => event.data.traceId)
            .on(TEST_PROCESS_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["operationInbox", definition]]),
      }).subscribers;

      await subscriber!.handle(physicalEvent("physical-1"), {
        tenantId,
        aggregateId: "trigger-1",
      });

      expect(
        await store.findByRef({
          ref: {
            processName: "operationInbox",
            projectId: tenantId,
            processKey: "trace-1",
          },
        }),
      ).toMatchObject({ state: { count: 1 } });
      expect(
        await store.findByRef({
          ref: {
            processName: "operationInbox",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        }),
      ).toBeNull();
      await runtime.stop();
    });
  });

  describe("given a registered signal handler", () => {
    it("schema-validates and synchronously returns its committed state", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "signalInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TEST_PROCESS_EVENT_TYPE, (state) => ({ state }))
            .onSignal(
              "increment",
              z.object({ by: z.number().int().positive() }),
              (state, data) => ({ state: { count: state.count + data.by } }),
            ),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["signalInbox", definition]]),
      }).subscribers;
      await subscriber!.handle(physicalEvent("physical-1"), {
        tenantId,
        aggregateId: "trigger-1",
      });

      const result = await runtime.signal<{ count: number }>({
        processName: "signalInbox",
        signal: {
          signalId: "increment-1",
          signalType: "increment",
          occurredAt: 1_001,
          projectId: tenantId,
          processKey: "trigger-1",
          payload: { by: 2 },
        },
        now: 1_001,
      });

      expect(result).toMatchObject({
        outcome: "committed",
        revision: 2,
        state: { count: 2 },
      });

      await expect(
        runtime.signal({
          processName: "signalInbox",
          signal: {
            signalId: "increment-invalid",
            signalType: "increment",
            occurredAt: 1_002,
            projectId: tenantId,
            processKey: "trigger-1",
            payload: { by: -1 },
          },
          now: 1_002,
        }),
      ).rejects.toThrow();
      expect(
        await store.findByRef({
          ref: {
            processName: "signalInbox",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        }),
      ).toMatchObject({ revision: 2, state: { count: 2 } });

      await runtime.stop();
    });
  });

  describe("given duplicate physical rows share one logical event key", () => {
    it("evolves the process exactly once", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "logicalInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TEST_PROCESS_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["logicalInbox", definition]]),
      }).subscribers;
      const context = {
        tenantId,
        aggregateId: "trigger-1",
        isReplay: false,
      };

      await subscriber!.handle(physicalEvent("physical-1"), context);
      await subscriber!.handle(physicalEvent("physical-2"), context);

      const process = await store.findByRef<{ count: number }>({
        ref: {
          processName: "logicalInbox",
          projectId: tenantId,
          processKey: "trigger-1",
        },
      });
      expect(process?.state).toEqual({ count: 1 });
      await runtime.stop();
    });
  });

  describe("given the store reports a revision conflict on commit", () => {
    it("throws naming the process manager and the source event", async () => {
      const store = makeStubStore({
        commit: async () => ({
          outcome: "revisionConflict" as const,
          actualRevision: 3,
        }),
      });
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "conflictInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TEST_PROCESS_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["conflictInbox", definition]]),
      }).subscribers;
      const context = {
        tenantId,
        aggregateId: "trigger-1",
        isReplay: false,
      };

      await expect(subscriber!.handle(physicalEvent("physical-1"), context)).rejects.toThrow(
        'Process manager "conflictInbox" revision conflict on event physical-1',
      );

      await runtime.stop();
    });
  });

  describe("given a process manager name is registered by two pipelines", () => {
    it("throws mounted by more than one pipeline", () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "dupeInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TEST_PROCESS_EVENT_TYPE, (state) => ({ state })),
      });

      runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["dupeInbox", definition]]),
      });

      expect(() =>
        runtime.registerPipeline<ProcessTestEvent>({
          pipelineName: "automations-second",
          processManagers: new Map([["dupeInbox", definition]]),
        }),
      ).toThrow('Process manager "dupeInbox" is mounted by more than one pipeline');
    });
  });

  describe("given a scheduled process manager is registered with consumers enabled", () => {
    it("arms nextWakeAt on the singleton scheduled process", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "scheduledSweep",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["scheduledSweep", definition]]),
      });

      await vi.waitFor(async () => {
        const process = await store.findByRef({
          ref: {
            processName: "scheduledSweep",
            projectId: SCHEDULED_SINGLETON_PROJECT_ID,
            processKey: "scheduledSweep",
          },
        });
        expect(process?.nextWakeAt).not.toBeNull();
      });

      await runtime.stop();
    });
  });

  describe("given schedule arming rejects", () => {
    it("logs the failure via the runtime logger instead of throwing", async () => {
      const store = makeStubStore({
        commit: async () => {
          throw new Error("boom");
        },
      });
      const logger = makeLogger();
      const runtime = new ProcessRuntime({
        store,
        consumersEnabled: true,
        logger,
      });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "scheduledFailure",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      expect(() =>
        runtime.registerPipeline<ProcessTestEvent>({
          pipelineName: "automations",
          processManagers: new Map([["scheduledFailure", definition]]),
        }),
      ).not.toThrow();

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: "scheduledFailure",
          error: "boom",
        }),
        "Schedule arming failed; the next worker boot will retry",
      );

      await runtime.stop();
    });
  });
});
