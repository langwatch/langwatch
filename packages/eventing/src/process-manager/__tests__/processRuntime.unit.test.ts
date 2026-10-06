import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTenantId } from "../../domain/tenantId.ts";
import { buildProcessManager } from "../../pipeline/processBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { ProcessOutboxWorker } from "../outbox/processOutboxWorker.ts";
import { ProcessRuntime, SCHEDULED_SINGLETON_PROJECT_ID } from "../processRuntime.ts";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore.ts";
import type { ProcessStore } from "../stores/processStore.types.ts";

const tenantId = createTenantId("project-1");
const TEST_PROCESS_EVENT_TYPE = "test.process.triggered";
const testProcessEventSchema = testEventSchema(
  TEST_PROCESS_EVENT_TYPE,
  z.object({ traceId: z.string() }),
);
type ProcessTestEvent = z.infer<typeof testProcessEventSchema>;

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
    transact: async () => {
      throw new Error("makeStubStore: transact not stubbed");
    },
    countPendingMessages: async () => ({ count: 0, nextAttemptAt: null }),
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
    findProcessKeys: async () => [],
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

/** The same event landing on a different process instance. */
function keyedEvent({ id, traceId }: { id: string; traceId: string }): ProcessTestEvent {
  return {
    ...physicalEvent(id),
    idempotencyKey: `${id}:${traceId}`,
    data: { traceId },
  };
}

/** Records which process manager's outbox worker each notify() nudged. */
function spyOnOutboxNudges(): string[] {
  const nudged: string[] = [];
  vi.spyOn(ProcessOutboxWorker.prototype, "notify").mockImplementation(function (
    this: ProcessOutboxWorker,
  ) {
    nudged.push(String(Reflect.get(this, "name")));
  });
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
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "tallyOnly",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state, data, ctx) => ({
              state: { count: state.count + 1 },
              intents:
                data.traceId === "send" ? [ctx.intent("noop", `noop:${state.count}`, {})] : [],
            })),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["tallyOnly", definition]]),
      }).subscribers;

      await subscriber!.handle(keyedEvent({ id: "quiet-1", traceId: "quiet" }), {
        tenantId,
        aggregateId: "trigger-1",
      });
      expect(nudged).toEqual([]);

      await subscriber!.handle(keyedEvent({ id: "send-1", traceId: "send" }), {
        tenantId,
        aggregateId: "trigger-1",
      });
      expect(nudged).toEqual(["tallyOnly"]);
      await runtime.stop();
    });
  });

  describe("given two scheduled process managers share one runtime", () => {
    /** @scenario "A wake nudges only the outbox of the process it woke" */
    it("nudges only the outbox of the process whose wake inserted an intent", async () => {
      vi.useFakeTimers();
      const nudged = spyOnOutboxNudges();
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const sweeping = buildProcessManager<ProcessTestEvent>({
        name: "sweeping",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .schedule({ everyMs: 1 })
            .onWake((state, ctx) => ({
              state,
              intents: [ctx.intent("sweep", `sweep:${ctx.at}`, {})],
            }))
            .intent("sweep", z.object({}), async () => {}),
      });
      const resting = buildProcessManager<ProcessTestEvent>({
        name: "resting",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .schedule({ everyMs: 1 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });

      runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([
          ["sweeping", sweeping],
          ["resting", resting],
        ]),
      });
      // The wake worker's first scan runs before the schedules arm; the next one finds both.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(nudged).toEqual(["sweeping"]);
      await runtime.stop();
    });
  });

  describe("given a process manager derives an operation key from its event", () => {
    it("persists the process under that key instead of the aggregate ID", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "operationInbox",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .keyBy((event) => event.data.traceId)
            .on(testProcessEventSchema, (state) => ({
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

  describe("given a keyed process manager gathers several aggregates", () => {
    it("lanes its deliveries by the process key and evolves one instance per key", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "keyedInbox",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .keyBy((event) => `trace:${event.data.traceId}`)
            .on(testProcessEventSchema, (state) => ({
              state: { count: state.count + 1 },
            })),
      });
      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["keyedInbox", definition]]),
      }).subscribers;

      // Without the lane, two deliveries to one instance run concurrently and
      // fight over its revision; the group key is what serializes them.
      expect(
        subscriber!.options?.groupKeyFn?.(keyedEvent({ id: "physical-1", traceId: "trace-1" })),
      ).toBe("trace:trace-1");
      expect(
        subscriber!.options?.groupKeyFn?.(keyedEvent({ id: "physical-2", traceId: "trace-2" })),
      ).toBe("trace:trace-2");

      const context = { tenantId, aggregateId: "trigger-1" };
      await subscriber!.handle(keyedEvent({ id: "physical-1", traceId: "trace-1" }), context);
      await subscriber!.handle(keyedEvent({ id: "physical-2", traceId: "trace-1" }), context);
      await subscriber!.handle(keyedEvent({ id: "physical-3", traceId: "trace-2" }), context);

      const findKey = async (processKey: string) =>
        store.findByRef<{ count: number }>({
          ref: { processName: "keyedInbox", projectId: tenantId, processKey },
        });
      expect((await findKey("trace:trace-1"))?.state).toEqual({ count: 2 });
      expect((await findKey("trace:trace-2"))?.state).toEqual({ count: 1 });
      await runtime.stop();
    });
  });

  describe("given a process manager declares no key", () => {
    it("leaves the subscriber on the default aggregate lane", () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "unkeyedInbox",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state) => ({ state })),
      });

      const [subscriber] = runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["unkeyedInbox", definition]]),
      }).subscribers;

      expect(subscriber!.options?.groupKeyFn).toBeUndefined();
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
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state) => ({ state }))
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
      ).rejects.toThrow(z.ZodError);
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
    /** @scenario "A process manager redelivery does not evolve state twice" */
    it("evolves the process exactly once", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "logicalInbox",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state) => ({
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
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state) => ({
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
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("noop", z.object({}), async () => {})
            .on(testProcessEventSchema, (state) => ({ state })),
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
    /** @scenario "A process manager can schedule its next wake" */
    it("arms nextWakeAt on the singleton scheduled process", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "scheduledSweep",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
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

  describe("given a held runtime registers a scheduled process manager", () => {
    it("arms nothing until start, then arms the schedule", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const runtime = new ProcessRuntime({ store, consumersEnabled: true, held: true });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "heldSweep",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .schedule({ everyMs: 60_000 })
            .onWake((state) => ({ state }))
            .intent("noop", z.object({}), async () => {}),
      });
      const ref = {
        processName: "heldSweep",
        projectId: SCHEDULED_SINGLETON_PROJECT_ID,
        processKey: "heldSweep",
      };

      runtime.registerPipeline<ProcessTestEvent>({
        pipelineName: "automations",
        processManagers: new Map([["heldSweep", definition]]),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await store.findByRef({ ref })).toBeNull();

      runtime.start();
      await vi.waitFor(async () => {
        expect((await store.findByRef({ ref }))?.nextWakeAt).not.toBeNull();
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
      const { logger, lines } = createTestLogger();
      const runtime = new ProcessRuntime({
        store,
        consumersEnabled: true,
        logger,
      });
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "scheduledFailure",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
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

      await vi.waitFor(() => expect(lines.filter((line) => line.level === 50)).toHaveLength(1));
      expect(
        lines.findLine("error", "Schedule arming failed; the next worker boot will retry"),
      ).toMatchObject({
        processName: "scheduledFailure",
        error: "boom",
      });

      await runtime.stop();
    });
  });
});
