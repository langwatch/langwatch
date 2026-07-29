import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTenantId } from "../../domain/tenantId";
import { buildProcessManager } from "../../pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../pipelines/automations/schemas/constants";
import {
  type AutomationEvent,
  triggerMatchRecordedEventSchema,
} from "../../pipelines/automations/schemas/events";
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
    findMessagesByRef: async () => [],
    leaseDueMessages: async () => [],
    markDispatched: async () => {},
    markFailed: async () => {},
    findDueWakes: async () => [],
    deleteDispatchedBefore: async () => 0,
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

describe("ProcessRuntime", () => {
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
    /** @scenario a schedule with no deadline yet is armed by a worker boot */
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

  describe("given a daily schedule and a fleet that boots a worker every day", () => {
    /**
     * The arm is inbox-deduped per calendar day, so exactly one arm commits per
     * day — but an arm that recomputes the deadline from `now` pushes it out by
     * another whole interval every time. At a 24h interval that is a deadline
     * that never matures: no error, no metric, just maintenance work that never
     * runs. Days are walked here rather than a conditional asserted, because
     * the defect only shows up across repeated arms.
     *
     * @scenario a schedule longer than the gap between worker boots still comes due
     */
    it("keeps the deadline the first arm set, so the schedule still comes due", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const store = new InMemoryProcessStore();
        const everyMs = 24 * 60 * 60 * 1000;
        const definition = buildProcessManager<AutomationEvent>({
          name: "dailyPrune",
          applier: (pm) =>
            pm
              .state({ count: 0 })
              // The count is the maintenance work itself: a schedule whose
              // deadline is pushed out on every arm never increments it.
              .onWake((state) => ({ state: { count: state.count + 1 } }))
              .schedule({ everyMs })
              .intent("noop", z.object({}), async () => {}),
        });
        const ref = {
          processName: "dailyPrune",
          projectId: SCHEDULED_SINGLETON_PROJECT_ID,
          processKey: "dailyPrune",
        };

        // Each boot is a fresh runtime over the shared store, which is what a
        // worker restart is. The hour walks BACKWARDS across days: a fleet
        // whose first boot of the day lands earlier than the previous day's
        // arm is the ordinary case, and it is exactly the one that outruns the
        // deadline.
        const boot = async (at: string) => {
          vi.setSystemTime(new Date(at));
          const runtime = new ProcessRuntime({ store, consumersEnabled: true });
          runtime.registerPipeline<AutomationEvent>({
            pipelineName: "automations",
            processManagers: new Map([["dailyPrune", definition]]),
          });
          // The arm is fire-and-forget over an in-memory store, so every step
          // of it is a microtask; one macrotask tick drains them all.
          await new Promise((resolve) => setImmediate(resolve));
          await runtime.stop();
        };

        await boot("2026-01-01T09:00:00.000Z");
        const armedDeadline = (await store.findByRef({ ref }))?.nextWakeAt;
        expect(armedDeadline).toBe(
          new Date("2026-01-01T09:00:00.000Z").getTime() + everyMs,
        );

        // A boot on the next calendar day, still short of the deadline: the
        // arm must not move it, or it never matures.
        await boot("2026-01-02T08:00:00.000Z");
        const beforeMaturity = await store.findByRef<{ count: number }>({
          ref,
        });
        expect(beforeMaturity?.nextWakeAt).toBe(armedDeadline);
        expect(beforeMaturity?.state).toEqual({ count: 0 });

        // An hour past the deadline the wake worker finds it due and the work
        // runs — once, and re-armed a whole interval on from the slot served.
        await boot("2026-01-02T10:00:00.000Z");
        const afterMaturity = await store.findByRef<{ count: number }>({ ref });
        expect(afterMaturity?.state).toEqual({ count: 1 });
        expect(afterMaturity?.nextWakeAt).toBe(
          new Date("2026-01-02T10:00:00.000Z").getTime() + everyMs,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given schedule arming rejects", () => {
    /** @scenario a schedule that cannot be armed leaves the worker running */
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
