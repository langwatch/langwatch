import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  InMemoryProcessStore,
  type Event,
  type EventSourcedQueueProcessor,
  type MapProjectionDefinition,
  type ProcessStore,
  type ReplayMarkerChecker,
  type SubscriberDispatchDefinition,
} from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createEventingRetentionConfiguration,
  EventingServerRuntime,
} from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";
import {
  WorkerEventingRuntime,
  type WorkerEventingConsumerOptions,
  type WorkerEventingProductionOptions,
} from "../worker-eventing.runtime";

/**
 * A cross-pipeline map projection and the subscriber that follows it, reduced
 * to the shape the registry needs. The live SaaS pair is the billable-events
 * meter and its usage-reporting dispatch; what matters here is that both land
 * in the shared job registry under `global:`, because that is the namespace a
 * consumer of `event-sourcing/jobs` has to be able to route.
 */
const meterProjection: MapProjectionDefinition<{ eventId: string }, Event> = {
  name: "orgBillableEventsMeter",
  eventTypes: ["lw.obs.trace.span_received"],
  map: (event) => ({ eventId: event.id }),
  store: { append: async () => void 0 },
};

const meterDispatch: SubscriberDispatchDefinition<Event> = {
  name: "billingMeterDispatch",
  options: { runIn: ["worker"] },
  handle: async () => void 0,
};

/** A real registration, so the projection registry initializes its queues. */
function anyPipeline() {
  return createBlobMaintenancePipeline({
    cleanup: {
      sweep: async () => ({
        queues: [],
        totals: {
          scanned: 0,
          truncated: false,
          leased: 0,
          repaired: 0,
          reclaimed: 0,
          bookkeeping: 0,
          pending: 0,
        },
        dryRun: false,
        durationMs: 0,
      }),
      deleteDispatchedBefore: async () => 0,
    },
  });
}

class TestQueue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

describe("WorkerEventingRuntime", () => {
  it("requires completed registrations before it awaits producer-only queue readiness", async () => {
    const queue = new TestQueue();
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
    });

    await expect(runtime.start()).rejects.toThrow(
      "Worker Eventing registrations must complete before queue readiness is awaited.",
    );
    expect(queue.waitUntilReady).not.toHaveBeenCalled();

    runtime.completeRegistrations();
    await runtime.start();
    await runtime.close();

    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("shares one failed readiness attempt and permits a later retry", async () => {
    const queue = new TestQueue();
    const readinessError = new Error("Redis is unavailable");
    queue.waitUntilReady.mockRejectedValueOnce(readinessError).mockResolvedValueOnce(void 0);
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
    });

    runtime.completeRegistrations();
    const firstStart = runtime.start();
    const concurrentStart = runtime.start();

    expect(concurrentStart).toBe(firstStart);
    await expect(firstStart).rejects.toThrow(readinessError);
    await expect(concurrentStart).rejects.toThrow(readinessError);
    expect(queue.waitUntilReady).toHaveBeenCalledOnce();

    await runtime.start();

    expect(queue.waitUntilReady).toHaveBeenCalledTimes(2);
  });

  it("rejects a new start after closing", async () => {
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => new TestQueue(),
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });

    runtime.completeRegistrations();
    await runtime.close();

    await expect(runtime.start()).rejects.toThrow("Worker Eventing runtime is closed.");
  });
});

describe("WorkerEventingRuntime global projections", () => {
  describe("given cross-pipeline projections the composition root supplies", () => {
    describe("when the first pipeline registers", () => {
      it("routes their jobs through the same shared registry as every pipeline", () => {
        const runtime = WorkerEventingRuntime.create({
          eventStore: EventStoreMemory.createForTesting(),
          queueFactory: () => new TestQueue(),
          processStore: InMemoryProcessStore.createForTesting(),
          executionTarget: "worker",
          warnWhenProjectionsRunInline: false,
          consumers: { enabled: false },
          configureGlobalProjections: (registry) => {
            registry.registerMapProjection(meterProjection);
            registry.registerMapSubscriber("orgBillableEventsMeter", meterDispatch);
          },
        });

        runtime.eventSourcing.register(anyPipeline());

        expect([...runtime.eventSourcing.globalJobRegistry.keys()]).toEqual(
          expect.arrayContaining([
            "global:handler:orgBillableEventsMeter",
            "global:reactor:billingMeterDispatch",
          ]),
        );
      });
    });
  });

  describe("given a composition root that supplies none", () => {
    describe("when the first pipeline registers", () => {
      it("registers no global routing keys at all", () => {
        const runtime = WorkerEventingRuntime.create({
          eventStore: EventStoreMemory.createForTesting(),
          queueFactory: () => new TestQueue(),
          processStore: InMemoryProcessStore.createForTesting(),
          executionTarget: "worker",
          warnWhenProjectionsRunInline: false,
          consumers: { enabled: false },
        });

        runtime.eventSourcing.register(anyPipeline());

        expect(
          [...runtime.eventSourcing.globalJobRegistry.keys()].filter((key) =>
            key.startsWith("global:"),
          ),
        ).toEqual([]);
      });
    });
  });
});

/**
 * Consumer ownership is one decision with two effects, and a graph that got
 * only one of them is worse than one that got neither: the Group Queue factory
 * decides whether a queue definition also starts a consumer loop, and the
 * Eventing runtime decides whether the process-manager outbox, wake and
 * schedule workers run. A runtime that claims jobs but never drains its own
 * process managers looks healthy and settles nothing.
 */
describe("WorkerEventingRuntime consumer ownership", () => {
  /** Ports the stubbed server runtime never reads; only the decision matters. */
  function serverPersistence(): WorkerEventingProductionOptions["persistence"] {
    return {
      database: {} as never,
      resolveClickHouseClient: (async () => ({})) as never,
      groupQueue: { redis: {} as never },
      retention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
    };
  }

  function stubServerRuntime(processStore: ProcessStore): EventingServerRuntime {
    return {
      dependencies: () => ({
        eventStore: EventStoreMemory.createForTesting(),
        processStore,
        queueFactory: () => new TestQueue(),
      }),
    } as unknown as EventingServerRuntime;
  }

  describe("given a production graph built with no consumer option", () => {
    it("leaves both the queue factory and the process-manager workers producer-only", async () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const leaseDueMessages = vi.spyOn(processStore, "leaseDueMessages");
      const create = vi
        .spyOn(EventingServerRuntime, "create")
        .mockReturnValue(stubServerRuntime(processStore));

      try {
        const runtime = WorkerEventingRuntime.createProduction({
          persistence: serverPersistence(),
          warnWhenProjectionsRunInline: false,
        });
        runtime.eventSourcing.register(anyPipeline());

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ consumersEnabled: false }));
        await runtime.close();
        expect(leaseDueMessages).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
      }
    });
  });

  describe("given a production graph the composition root asks to consume", () => {
    it("enables both the queue factory and the process-manager workers", async () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const leaseDueMessages = vi.spyOn(processStore, "leaseDueMessages");
      const create = vi
        .spyOn(EventingServerRuntime, "create")
        .mockReturnValue(stubServerRuntime(processStore));

      try {
        const runtime = WorkerEventingRuntime.createProduction({
          persistence: serverPersistence(),
          warnWhenProjectionsRunInline: false,
          consumers: { enabled: true },
        });
        runtime.eventSourcing.register(anyPipeline());

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ consumersEnabled: true }));
        await vi.waitFor(() => expect(leaseDueMessages).toHaveBeenCalled());
        await runtime.close();
      } finally {
        create.mockRestore();
      }
    });
  });
});

/**
 * The replay marker is a consuming-side concern and nothing else: the CLI
 * writes a cutoff to Redis and the projection that folds the event is what has
 * to read it. A packaged consumer without one applies events a replay is
 * mid-way through re-deriving, and both writers land on the same aggregate.
 */
describe("WorkerEventingRuntime replay markers", () => {
  function projectionFixture(consumers: WorkerEventingConsumerOptions) {
    const map = vi.fn((event: Event) => ({ eventId: event.id }));
    const runtime = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => new TestQueue(),
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers,
    });
    runtime.eventSourcing.register(
      definePipeline<Event>({
        name: "replay_probe",
        aggregate: defineAggregate({
          type: "trace",
          events: defineEvents(["lw.obs.trace.span_received"] as const),
        }),
      })
        .withClickHouseMapProjection({
          name: "replayProbe",
          eventTypes: ["lw.obs.trace.span_received"],
          map,
          store: { append: async () => void 0 },
        })
        .build(),
    );
    const entry = runtime.eventSourcing.globalJobRegistry.get("replay_probe:handler:replayProbe");
    if (!entry) throw new Error("the probe pipeline registered no map projection job");
    return { map, runtime, process: entry.process };
  }

  const spanReceived = {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project_test",
    type: "lw.obs.trace.span_received",
    createdAt: 1,
    occurredAt: 1,
    version: "2026-01-01",
    data: {},
  };

  describe("given a consuming runtime the composition root gave a checker", () => {
    describe("when the checker defers to an active replay", () => {
      it("leaves the event to the replay rather than applying it", async () => {
        const checker: ReplayMarkerChecker = {
          check: vi.fn(async (_projectionName: string, _event: Event) => "skip" as const),
        };
        const fixture = projectionFixture({
          enabled: true,
          replayMarkerChecker: checker,
        });

        await fixture.process(spanReceived);
        await fixture.runtime.close();

        expect(checker.check).toHaveBeenCalledWith("replayProbe", spanReceived);
        expect(fixture.map).not.toHaveBeenCalled();
      });
    });

    describe("when no replay is active", () => {
      it("applies the event, as the checker told it to", async () => {
        const fixture = projectionFixture({
          enabled: true,
          replayMarkerChecker: { check: async () => "process" },
        });

        await fixture.process(spanReceived);
        await fixture.runtime.close();

        expect(fixture.map).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given a consuming runtime the composition root gave none", () => {
    it("applies the event with no marker read at all", async () => {
      const fixture = projectionFixture({ enabled: true });

      await fixture.process(spanReceived);
      await fixture.runtime.close();

      expect(fixture.map).toHaveBeenCalledOnce();
    });
  });
});
