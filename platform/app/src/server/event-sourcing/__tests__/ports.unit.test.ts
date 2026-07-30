import type {
  BuiltPipeline,
  LaneExecution,
  WireEvent,
} from "@langwatch/event-sourcing";
import {
  memoryClock,
  memoryOutbox,
  memoryProcessStore,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createGenericLaneExecutors,
  createOutboxWorker,
  createProcessWakePoller,
} from "../ports";

/**
 * The generic lane executors resolve a lane down to the concrete built
 * member and run it — the composition root's job (`consumer.ts`'s own
 * docblock says so), which nothing in the package or a pipeline directory
 * does for it.
 */

function stubPipeline(overrides: Partial<BuiltPipeline> = {}): BuiltPipeline {
  return {
    name: "stub",
    prefix: undefined,
    eventTypes: [],
    commands: {},
    folds: {},
    maps: {},
    processManagers: {},
    subscribers: {},
    aggregateIdFor: () => "unused",
    ...overrides,
  } as BuiltPipeline;
}

function execution(overrides: Partial<LaneExecution> = {}): LaneExecution {
  return {
    pipeline: stubPipeline(),
    name: "member",
    tenantId: "tenant-1",
    aggregateId: "agg-1",
    events: [
      { type: "thing/happened", data: { ok: true } },
    ] satisfies WireEvent[],
    ...overrides,
  };
}

describe("createGenericLaneExecutors", () => {
  describe("given a fold lane", () => {
    it("applies the fold with the aggregate id as its key", async () => {
      const calls: unknown[] = [];
      const pipeline = stubPipeline({
        folds: {
          member: {
            name: "member",
            eventTypes: ["thing/happened"],
            stateVersion: "1",
            schemaHash: "h",
            apply: async (delivery) => {
              calls.push(delivery);
              return { events: delivery.events.length };
            },
          },
        },
      });
      const executors = createGenericLaneExecutors({
        processStore: memoryProcessStore(),
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });

      await executors.fold(execution({ pipeline }));

      expect(calls).toEqual([
        { key: "agg-1", tenantId: "tenant-1", events: execution().events },
      ]);
    });

    it("throws when the pipeline mounts no fold of that name", async () => {
      const executors = createGenericLaneExecutors({
        processStore: memoryProcessStore(),
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });
      await expect(executors.fold(execution())).rejects.toThrow(
        /no fold named/,
      );
    });
  });

  describe("given a map lane", () => {
    it("applies the map without an aggregate-scoped key", async () => {
      const calls: unknown[] = [];
      const pipeline = stubPipeline({
        maps: {
          member: {
            name: "member",
            eventTypes: ["thing/happened"],
            apply: async (delivery) => {
              calls.push(delivery);
              return { written: delivery.events.length };
            },
          },
        },
      });
      const executors = createGenericLaneExecutors({
        processStore: memoryProcessStore(),
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });

      await executors.map(execution({ pipeline }));

      expect(calls).toEqual([
        { tenantId: "tenant-1", events: execution().events },
      ]);
    });
  });

  describe("given a subscriber lane", () => {
    it("runs the subscriber once per event, in order", async () => {
      const seen: unknown[] = [];
      const pipeline = stubPipeline({
        subscribers: {
          member: {
            name: "member",
            eventTypes: ["thing/happened"],
            handle: async (event, ctx) => {
              seen.push([event, ctx.tenantId]);
            },
          },
        },
      });
      const executors = createGenericLaneExecutors({
        processStore: memoryProcessStore(),
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });
      const events: WireEvent[] = [
        { type: "thing/happened", data: { n: 1 } },
        { type: "thing/happened", data: { n: 2 } },
      ];

      await executors.subscriber(execution({ pipeline, events }));

      expect(seen).toEqual([
        [events[0], "tenant-1"],
        [events[1], "tenant-1"],
      ]);
    });
  });

  describe("given a process manager lane", () => {
    const stateSchema = z.object({
      count: z.number(),
      lastEvent: z.string().nullable(),
    });
    const payloadSchema = z.object({ n: z.number() });

    function pmPipeline(
      evolve: (
        state: z.infer<typeof stateSchema>,
        event: WireEvent,
      ) => z.infer<typeof stateSchema> | null,
    ): BuiltPipeline {
      return stubPipeline({
        processManagers: {
          digest: {
            name: "digest",
            enabled: true,
            eventTypes: ["thing/happened"],
            intentTypes: ["notify"],
            stateSchema,
            stateVersion: "1",
            schemaHash: "h",
            intents: {
              notify: {
                payload: payloadSchema,
                messageKey: (payload) =>
                  `notify:${(payload as { n: number }).n}`,
                deliver: async () => undefined,
              },
            },
            init: () => ({ count: 0, lastEvent: null }),
            evolve: (state, event) => {
              const next = evolve(state, event);
              if (next === null) return null;
              return {
                state: next,
                intents: [{ type: "notify", payload: { n: next.count } }],
                nextWakeAt: null,
              };
            },
          },
        },
      });
    }

    it("folds a batch left-to-right and saves once", async () => {
      const processStore = memoryProcessStore();
      const executors = createGenericLaneExecutors({
        processStore,
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });
      const pipeline = pmPipeline((state, event) => ({
        count: state.count + 1,
        lastEvent: event.type,
      }));
      const events: WireEvent[] = [
        { type: "thing/happened", data: {} },
        { type: "thing/happened", data: {} },
        { type: "thing/happened", data: {} },
      ];

      await executors.processManager(
        execution({ pipeline, name: "digest", events }),
      );

      const stored = await processStore.load({
        processName: "digest",
        projectId: "tenant-1",
        processKey: "agg-1",
      });
      expect(stored?.state).toEqual({ count: 3, lastEvent: "thing/happened" });
      expect(stored?.revision).toBe(1);
    });

    it("stages one outbox row per emitted intent, qualified by processName/intentType", async () => {
      const outbox = memoryOutbox(memoryClock());
      const executors = createGenericLaneExecutors({
        processStore: memoryProcessStore(),
        outbox,
        clock: memoryClock(),
      });
      const pipeline = pmPipeline((state) => ({
        count: state.count + 1,
        lastEvent: "x",
      }));

      await executors.processManager(execution({ pipeline, name: "digest" }));

      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]?.intentType).toBe("digest/notify");
      expect(outbox.rows[0]?.tenantId).toBe("tenant-1");
    });

    it("does not touch stored state when no event in the batch has a handler", async () => {
      const processStore = memoryProcessStore();
      const executors = createGenericLaneExecutors({
        processStore,
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });
      const pipeline = pmPipeline(() => null);

      await executors.processManager(execution({ pipeline, name: "digest" }));

      const stored = await processStore.load({
        processName: "digest",
        projectId: "tenant-1",
        processKey: "agg-1",
      });
      expect(stored).toBeNull();
    });

    it("throws rather than silently resetting an incompatible stored version", async () => {
      const processStore = memoryProcessStore();
      await processStore.save({
        key: {
          processName: "digest",
          projectId: "tenant-1",
          processKey: "agg-1",
        },
        tenantId: "tenant-1",
        state: { count: 9, lastEvent: null },
        stateVersion: "0-stale",
        expectedRevision: 0,
        nextWakeAt: null,
      });
      const executors = createGenericLaneExecutors({
        processStore,
        outbox: memoryOutbox(memoryClock()),
        clock: memoryClock(),
      });
      const pipeline = pmPipeline((state) => ({
        count: state.count + 1,
        lastEvent: "x",
      }));

      await expect(
        executors.processManager(execution({ pipeline, name: "digest" })),
      ).rejects.toThrow(/cannot resume instance/);
    });
  });
});

describe("createOutboxWorker", () => {
  it("delivers a staged intent and settles it", async () => {
    const clock = memoryClock();
    const outbox = memoryOutbox(clock);
    const delivered: unknown[] = [];
    const payloadSchema = z.object({ n: z.number() });
    const pipeline = stubPipeline({
      processManagers: {
        digest: {
          name: "digest",
          enabled: true,
          eventTypes: [],
          intentTypes: ["notify"],
          stateSchema: z.object({}),
          stateVersion: "1",
          schemaHash: "h",
          intents: {
            notify: {
              payload: payloadSchema,
              messageKey: (payload) => `notify:${(payload as { n: number }).n}`,
              deliver: async (payload) => {
                delivered.push(payload);
              },
            },
          },
          init: () => ({}),
          evolve: () => null,
        },
      },
    });
    const registry = { all: () => [{ pipeline, aggregateType: "digest" }] };

    await outbox.stage([
      {
        intentType: "digest/notify",
        messageKey: "notify:1",
        tenantId: "tenant-1",
        payload: JSON.stringify({ n: 1 }),
      },
    ]);

    const worker = createOutboxWorker({ outbox, registry, clock });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.stop();

    expect(delivered).toEqual([{ n: 1 }]);
    expect(outbox.rows[0]?.settledAt).not.toBeNull();
  });

  it("dead-letters a row naming no registered intent", async () => {
    const clock = memoryClock();
    const outbox = memoryOutbox(clock);
    const registry = { all: () => [] };
    await outbox.stage([
      {
        intentType: "ghost/notify",
        messageKey: "k",
        tenantId: "tenant-1",
        payload: "{}",
      },
    ]);

    const worker = createOutboxWorker({ outbox, registry, clock });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.stop();

    expect(outbox.dead()).toHaveLength(1);
  });
});

describe("createProcessWakePoller", () => {
  it("wakes a due instance, saves the result and stages its intents", async () => {
    const clock = memoryClock();
    const processStore = memoryProcessStore();
    const outbox = memoryOutbox(clock);
    const payloadSchema = z.object({ n: z.number() });
    const pipeline = stubPipeline({
      processManagers: {
        sweep: {
          name: "sweep",
          enabled: true,
          eventTypes: [],
          intentTypes: ["run"],
          stateSchema: z.object({ ticks: z.number() }),
          stateVersion: "1",
          schemaHash: "h",
          intents: {
            run: {
              payload: payloadSchema,
              messageKey: (payload) => `run:${(payload as { n: number }).n}`,
              deliver: async () => undefined,
            },
          },
          init: () => ({ ticks: 0 }),
          evolve: () => null,
          onWake: (state) => ({
            state: { ticks: state.ticks + 1 },
            // Qualified, the way `definePipeline` emits it — a bare key here
            // would let the poller pass against a shape no real pipeline emits.
            intents: [{ type: "sweep/run", payload: { n: state.ticks + 1 } }],
            nextWakeAt: clock.now() + 1000,
          }),
        },
      },
    });
    const registry = { all: () => [{ pipeline, aggregateType: "sweep" }] };

    await processStore.save({
      key: {
        processName: "sweep",
        projectId: "__global__",
        processKey: "__global__",
      },
      tenantId: "__global__",
      state: { ticks: 0 },
      stateVersion: "1",
      expectedRevision: 0,
      nextWakeAt: clock.now(),
    });

    const poller = createProcessWakePoller({
      processStore,
      outbox,
      registry,
      clock,
    });
    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await poller.stop();

    const stored = await processStore.load({
      processName: "sweep",
      projectId: "__global__",
      processKey: "__global__",
    });
    expect(stored?.state).toEqual({ ticks: 1 });
    expect(outbox.rows).toHaveLength(1);
  });
});
