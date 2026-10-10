import type { Logger } from "@langwatch/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTenantId } from "../../domain/tenantId";
import { buildProcessManager } from "../../pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../pipelines/automations/schemas/constants";
import {
  type AutomationEvent,
  triggerMatchRecordedEventSchema,
} from "../../pipelines/automations/schemas/events";
import { ProcessOutboxWorker } from "../outbox/processOutboxWorker";
import {
  ProcessRuntime,
  SCHEDULED_SINGLETON_PROJECT_ID,
} from "../processRuntime";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";
import type { ProcessStore } from "../stores/processStore.types";

const tenantId = createTenantId("project-1");

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

function physicalEvent(id: string) {
  return triggerMatchRecordedEventSchema.parse({
    id,
    idempotencyKey: "trigger-1:trace-1:30000-0",
    aggregateId: "trigger-1",
    aggregateType: "trigger",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
    version: "2026-07-18",
    data: {
      triggerId: "trigger-1",
      traceId: "trace-1",
      action: "SEND_EMAIL",
      actionClass: "notify",
      traceDebounceMs: 30_000,
      notificationCadence: "immediate",
    },
  });
}

/** The same trigger match under its own logical key and trace. */
function tracedEvent({ id, traceId }: { id: string; traceId: string }) {
  const event = physicalEvent(id);
  return {
    ...event,
    idempotencyKey: `trigger-1:${traceId}:30000-0`,
    data: { ...event.data, traceId },
  };
}

/** Records which process manager's outbox worker each notify() nudged. */
function spyOnOutboxNudges(): string[] {
  const nudged: string[] = [];
  vi.spyOn(ProcessOutboxWorker.prototype, "notify").mockImplementation(
    function (this: ProcessOutboxWorker) {
      nudged.push(String(Reflect.get(this, "name")));
    },
  );
  return nudged;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ProcessRuntime", () => {
  describe("given a process manager mounted with consumers enabled", () => {
    /** @scenario "A commit that inserted no intent does not nudge the outbox" */
    it("nudges its outbox only for a commit that inserted an intent", async () => {
      const nudged = spyOnOutboxNudges();
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const definition = buildProcessManager<AutomationEvent>({
        name: "tallyOnly",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => ({
              state: { count: state.count + 1 },
              intents:
                data.traceId === "send"
                  ? [ctx.intents.noop(`noop:${state.count}`, {})]
                  : [],
            })),
      });
      const [subscriber] = runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["tallyOnly", definition]]),
      }).subscribers;
      const context = { tenantId, aggregateId: "trigger-1", isReplay: false };

      await subscriber!.handle(
        tracedEvent({ id: "quiet-1", traceId: "quiet" }),
        context,
      );
      expect(nudged).toEqual([]);

      await subscriber!.handle(
        tracedEvent({ id: "send-1", traceId: "send" }),
        context,
      );
      expect(nudged).toEqual(["tallyOnly"]);
      await runtime.stop();
    });
  });

  describe("given two scheduled process managers share one runtime", () => {
    /** @scenario "A wake nudges only the outbox of the process it woke" */
    it("nudges only the outbox of the process whose wake inserted an intent", async () => {
      vi.useFakeTimers();
      const nudged = spyOnOutboxNudges();
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const sweeping = buildProcessManager<AutomationEvent>({
        name: "sweeping",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 1 })
            .intent("sweep", z.object({}), async () => {})
            .onWake((state, ctx) => ({
              state,
              intents: [ctx.intents.sweep(`sweep:${ctx.at}`, {})],
            })),
      });
      const resting = buildProcessManager<AutomationEvent>({
        name: "resting",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 1 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([
          ["sweeping", sweeping],
          ["resting", resting],
        ]),
      });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(nudged).toContain("sweeping");
      expect(nudged).not.toContain("resting");
      await runtime.stop();
    });
  });

  describe("given duplicate physical rows share one logical event key", () => {
    it("evolves the process exactly once", async () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<AutomationEvent>({
        name: "logicalInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<AutomationEvent>({
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
      expect(subscriber!.options?.groupKeyFn).toBeUndefined();
      await runtime.stop();
    });
  });

  describe("given a process manager declares keyBy", () => {
    it("keys the instance by it and drains those events in one lane", async () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<AutomationEvent>({
        name: "tenantWatch",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            }))
            .keyBy((event) => `tenant:${event.tenantId}`),
      });
      const [subscriber] = runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["tenantWatch", definition]]),
      }).subscribers;

      await subscriber!.handle(physicalEvent("physical-1"), {
        tenantId,
        aggregateId: "trigger-1",
      });

      const process = await store.findByRef<{ count: number }>({
        ref: {
          processName: "tenantWatch",
          projectId: tenantId,
          processKey: `tenant:${tenantId}`,
        },
      });
      expect(process?.state).toEqual({ count: 1 });
      expect(
        subscriber!.options?.groupKeyFn?.(physicalEvent("physical-1")),
      ).toBe(`tenant:${tenantId}`);
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
      const definition = buildProcessManager<AutomationEvent>({
        name: "conflictInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["conflictInbox", definition]]),
      }).subscribers;
      const context = {
        tenantId,
        aggregateId: "trigger-1",
        isReplay: false,
      };

      await expect(
        subscriber!.handle(physicalEvent("physical-1"), context),
      ).rejects.toThrow(
        'Process manager "conflictInbox" revision conflict on event physical-1',
      );

      await runtime.stop();
    });
  });

  describe("given a process manager name is registered by two pipelines", () => {
    it("throws mounted by more than one pipeline", () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<AutomationEvent>({
        name: "dupeInbox",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({ state })),
      });

      runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["dupeInbox", definition]]),
      });

      expect(() =>
        runtime.registerPipeline<AutomationEvent>({
          pipelineName: "automations-second",
          processManagers: new Map([["dupeInbox", definition]]),
        }),
      ).toThrow(
        'Process manager "dupeInbox" is mounted by more than one pipeline',
      );
    });
  });

  describe("given a scheduled process manager is registered with consumers enabled", () => {
    it("arms nextWakeAt on the singleton scheduled process", async () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const definition = buildProcessManager<AutomationEvent>({
        name: "scheduledSweep",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      runtime.registerPipeline<AutomationEvent>({
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

  describe("given a scheduled process manager is registered without consumers", () => {
    it("does not arm its singleton schedule outside the worker role", async () => {
      const store = new InMemoryProcessStore();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<AutomationEvent>({
        name: "webOnlySchedule",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      runtime.registerPipeline<AutomationEvent>({
        pipelineName: "automations",
        processManagers: new Map([["webOnlySchedule", definition]]),
      });

      await new Promise((resolve) => setImmediate(resolve));
      const process = await store.findByRef({
        ref: {
          processName: "webOnlySchedule",
          projectId: SCHEDULED_SINGLETON_PROJECT_ID,
          processKey: "webOnlySchedule",
        },
      });
      expect(process).toBeNull();

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
      const definition = buildProcessManager<AutomationEvent>({
        name: "scheduledFailure",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      expect(() =>
        runtime.registerPipeline<AutomationEvent>({
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
