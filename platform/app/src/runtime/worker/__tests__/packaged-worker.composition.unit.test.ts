/**
 * The platform composition root that turns the App's registry handoff into the
 * packaged worker graph — the half of the cutover that is built and tested
 * before anything boots it.
 *
 * Two properties matter here and nowhere else. First, exactly one composition
 * in the process claims `event-sourcing/jobs`: the App is asked to hand its
 * consumers over, and this root refuses to start rather than become a second
 * consumer or a silent producer-only worker. Second, the graph it mounts is the
 * one the App registered — the same definitions, in the same order, with none
 * of the App's own late bindings resolved a second time.
 *
 * Which routing keys those are is `worker-pipeline-parity`'s question; this file
 * asks whether the root wires them onto a runtime that can consume them.
 */
import { Deferred, InMemoryProcessStore, type ProcessStore } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingServerRuntime,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { TopicServerInstaller } from "@langwatch/topic-server";
import {
  resolveWorkerConfig,
  WorkerProductionComposition,
  type WorkerHandlePort,
  type WorkerTransportPort,
} from "@langwatch/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  packagedWorkerCapabilities,
  packagedWorkerEventing,
  PackagedWorkerConsumerRefusal,
  requirePackagedWorkerConsumer,
  workerCapabilityAlreadyConnected,
  type PackagedWorkerConsumerHandoff,
} from "~/runtime/worker/packaged-worker.capabilities";
import type {
  WorkerEventingHandoff,
  WorkerEventingSubstrate,
} from "~/server/app-layer/worker-eventing-handoff";
import {
  autoStub,
  buildLegacyRegistry,
  NoopLifecycle,
  NoopTransport,
  packagedHandoff,
  processPersistenceDatabase,
  type LegacyBuild,
} from "./legacy-registry.fixture";

/** The App's own instances, as the handoff carries them: shared, not rebuilt. */
function appSubstrate(overrides?: Partial<WorkerEventingSubstrate>): WorkerEventingSubstrate {
  return {
    prisma: processPersistenceDatabase() as never,
    resolveClickHouseClient: (async () => ({})) as never,
    groupQueue: { redis: {} } as never,
    persistenceRetention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
    retentionPolicyResolver: autoStub(),
    replayMarkerChecker: autoStub(),
    ...overrides,
  };
}

function handoffWith(overrides?: Partial<WorkerEventingHandoff>): WorkerEventingHandoff {
  return {
    appOwnsEventingConsumers: false,
    isSaas: false,
    capabilities: autoStub(),
    substrate: appSubstrate(),
    topic: autoStub(),
    ...overrides,
  };
}

describe("packaged worker consumer refusal", () => {
  describe("given an App that handed nothing over", () => {
    /**
     * Only worker-capable roles populate the handoff, so its absence means the
     * App built no registry to mount — a graph composed from nothing would
     * claim the queue and reject every job on it for redelivery.
     */
    it("refuses, naming the missing handoff", () => {
      expect(() =>
        requirePackagedWorkerConsumer({ handoff: undefined, clickHouseEnabled: true }),
      ).toThrow(PackagedWorkerConsumerRefusal);
      expect(() =>
        requirePackagedWorkerConsumer({ handoff: undefined, clickHouseEnabled: true }),
      ).toThrow("no worker eventing handoff");
    });
  });

  describe("given an App that kept the consumers itself", () => {
    /**
     * The one invariant the whole cutover rests on. Two consumers of one queue
     * in one process is not a degraded mode — both registries answer for the
     * same routing keys, so the second one to claim a job wins a race nobody
     * observes.
     */
    it("refuses rather than becoming a second consumer", () => {
      const handoff = handoffWith({ appOwnsEventingConsumers: true });

      expect(() => requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true })).toThrow(
        PackagedWorkerConsumerRefusal,
      );
      expect(() => requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true })).toThrow(
        "the App claimed the consumers itself",
      );
    });
  });

  describe("given a process without ClickHouse", () => {
    it("refuses, because the Eventing event store has no other backing", () => {
      const handoff = handoffWith();

      expect(() => requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: false })).toThrow(
        "ClickHouse is unavailable",
      );
    });
  });

  describe("given a process without Redis", () => {
    /**
     * `groupQueue` is absent exactly when the App had no Redis, which is also
     * when it built no queue factory: there is no `event-sourcing/jobs` for a
     * second graph to join, and a worker that started anyway would consume
     * nothing while reporting itself healthy.
     */
    it("refuses, because there is no group queue to join", () => {
      const handoff = handoffWith({ substrate: appSubstrate({ groupQueue: undefined }) });

      expect(() => requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true })).toThrow(
        "Redis is unavailable",
      );
    });
  });

  describe("given an App that handed over a consumable graph", () => {
    it("returns the handoff with its group queue narrowed", () => {
      const handoff = handoffWith();

      expect(requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true })).toBe(handoff);
    });
  });
});

describe("packaged worker eventing substrate", () => {
  const consumable = (overrides?: Partial<WorkerEventingSubstrate>) =>
    requirePackagedWorkerConsumer({
      handoff: handoffWith({ substrate: appSubstrate(overrides) }),
      clickHouseEnabled: true,
    });

  it("hands the App's own instances to the second runtime", () => {
    const handoff = consumable();
    const eventing = packagedWorkerEventing(handoff);

    expect(eventing.database).toBe(handoff.substrate.prisma);
    expect(eventing.resolveClickHouseClient).toBe(handoff.substrate.resolveClickHouseClient);
    expect(eventing.groupQueue).toBe(handoff.substrate.groupQueue);
    expect(eventing.retention).toBe(handoff.substrate.persistenceRetention);
    expect(eventing.retentionPolicyResolver).toBe(handoff.substrate.retentionPolicyResolver);
  });

  /**
   * The checker acts on the consuming side and nowhere else: it is consulted
   * per event before a projection applies it. A consumer without it folds
   * events a replay is mid-way through re-deriving, and both writers land on
   * the same aggregate.
   */
  it("carries the App's replay marker checker into the consumer option", () => {
    const handoff = consumable();

    expect(packagedWorkerEventing(handoff).consumers).toEqual({
      enabled: true,
      replayMarkerChecker: handoff.substrate.replayMarkerChecker,
    });
  });

  it("still claims the queue where the App built no replay marker", () => {
    expect(
      packagedWorkerEventing(consumable({ replayMarkerChecker: undefined })).consumers,
    ).toEqual({ enabled: true });
  });
});

class TestQueue {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

/**
 * The Eventing server runtime, reduced to ports that need no ClickHouse, no
 * Postgres and no Redis.
 *
 * Standing in for it is what lets this suite build the root with consumers
 * genuinely ON. The real one would instantiate a `GroupQueueConsumer` per queue
 * definition against the substrate it is given, and a guard must never claim
 * the queue a deployed worker is draining.
 */
function stubServerRuntime(processStore: ProcessStore): EventingServerRuntime {
  return {
    dependencies: () => ({
      eventStore: EventStoreMemory.createForTesting(),
      processStore,
      queueFactory: () => new TestQueue(),
    }),
  } as unknown as EventingServerRuntime;
}

describe("packaged worker composition root", () => {
  let serverRuntime: ReturnType<typeof vi.spyOn>;
  let bootSeeds: ReturnType<typeof vi.spyOn>;
  let processStore: InMemoryProcessStore;

  beforeEach(() => {
    processStore = InMemoryProcessStore.createForTesting();
    serverRuntime = vi
      .spyOn(EventingServerRuntime, "create")
      .mockImplementation(() => stubServerRuntime(processStore));
    // A one-time data migration that pages Postgres, not a registration.
    bootSeeds = vi
      .spyOn(TopicServerInstaller.prototype, "startBootSeeds")
      .mockImplementation(() => void 0);
  });

  afterEach(() => {
    serverRuntime.mockRestore();
    bootSeeds.mockRestore();
  });

  function composeRoot(
    legacy: LegacyBuild,
    overrides?: Partial<WorkerEventingHandoff>,
    transport: WorkerTransportPort = new NoopTransport(),
  ): WorkerProductionComposition {
    const handoff = requirePackagedWorkerConsumer({
      handoff: packagedHandoff(legacy, { substrate: appSubstrate(), ...overrides }),
      clickHouseEnabled: true,
    });
    const composition = WorkerProductionComposition.create({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing: packagedWorkerEventing(handoff),
      lifecycle: new NoopLifecycle(),
      transport,
      ...packagedWorkerCapabilities({
        handoff,
      }),
    });
    return composition;
  }

  describe("given the handoff a worker-role App exposes", () => {
    /**
     * Both sites, because half of the decision is a graph that claims jobs and
     * never drains its own process managers. The queue factory decides whether
     * a queue definition starts a consumer loop; the Eventing runtime decides
     * whether the outbox, wake and schedule workers run.
     */
    it("asks for consumers at the queue factory and at the process-manager workers", async () => {
      const leaseDueMessages = vi.spyOn(processStore, "leaseDueMessages");
      const composition = composeRoot(buildLegacyRegistry());

      expect(serverRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ consumersEnabled: true }),
      );

      for (const installer of composition.featureInstallers) await installer.install();
      await vi.waitFor(() => expect(leaseDueMessages).toHaveBeenCalled());
      await composition.eventing.close();
    });

    it("threads the App's retention resolver into the runtime it builds", () => {
      const legacy = buildLegacyRegistry();
      const substrate = appSubstrate();
      composeRoot(legacy, { substrate });

      expect(serverRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          retentionPolicyResolver: substrate.retentionPolicyResolver,
          groupQueue: substrate.groupQueue,
        }),
      );
    });

    /**
     * The order is load-bearing rather than incidental, and it is documented on
     * `orderedFeatureInstallers` next to the reason for each position.
     */
    it("mounts every feature the legacy registry registers, in mount order", () => {
      const composition = composeRoot(buildLegacyRegistry());

      expect(composition.featureInstallers.map((installer) => installer.name)).toEqual([
        "automation",
        "eventing-maintenance",
        "langy-maintenance",
        "api-key",
        "github",
        "evaluation",
        "coding-agent",
        "governance-events",
        "gateway-spend",
        "metric",
        "log",
        "trace",
        "suite",
        "scenario",
        "experiment",
        "langy-conversation",
        "topic",
        "governance-ingestion",
        "billing-reporting",
        "authz",
        "identity",
        "sso-connection",
        "scim-sync",
        "join-request",
      ]);
    });

    /**
     * Queue readiness is unavailable until registrations are sealed, and the
     * transport's non-Eventing loops start last. A root that awaited readiness
     * first would claim `event-sourcing/jobs` with a partial registry, and the
     * queue answers an unroutable job by redelivering it forever.
     */
    it("installs, seals registrations, waits for the queue, then starts the transport", async () => {
      const order: string[] = [];
      class RecordingTransport extends NoopTransport {
        async start(): Promise<WorkerHandlePort> {
          order.push("transport");
          return super.start();
        }
      }
      const composition = composeRoot(buildLegacyRegistry(), undefined, new RecordingTransport());
      const eventSourcing = composition.eventing.eventSourcing;
      const register = eventSourcing.register.bind(eventSourcing);
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        order.push(`register:${definition.metadata.name}`);
        return register(definition);
      });
      const complete = composition.eventing.completeRegistrations.bind(composition.eventing);
      vi.spyOn(composition.eventing, "completeRegistrations").mockImplementation(() => {
        order.push("completeRegistrations");
        complete();
      });
      const start = composition.eventing.start.bind(composition.eventing);
      vi.spyOn(composition.eventing, "start").mockImplementation(async () => {
        await start();
        order.push("queue-ready");
      });

      await composition.application.start();
      await composition.application.close();

      expect(order.filter((step) => step.startsWith("register:"))).toHaveLength(26);
      expect(order.slice(-3)).toEqual(["completeRegistrations", "queue-ready", "transport"]);
    });
  });

  /**
   * `registerAll()` already resolved every one of the App's late bindings
   * against the App's own dispatchers, and a `Deferred` refuses a second
   * resolution. The synthesized capabilities therefore hand the installers a
   * `connect*` that does nothing — the definitions arrive connected.
   */
  describe("given capabilities the App already connected", () => {
    it("supplies a connect hook that is the declared no-op, everywhere", () => {
      const capabilities = packagedWorkerCapabilities({
        handoff: handoffWith(),
      });

      expect([
        capabilities.gatewaySpend?.spend.connectSettlement,
        capabilities.scenario?.installer.connect,
        capabilities.langyConversation?.installer.connectCommands,
        capabilities.billingReporting?.installer.connectSelfDispatch,
        capabilities.authz?.installer.connect,
      ]).toEqual([
        workerCapabilityAlreadyConnected,
        workerCapabilityAlreadyConnected,
        workerCapabilityAlreadyConnected,
        workerCapabilityAlreadyConnected,
        workerCapabilityAlreadyConnected,
      ]);
    });

    /**
     * Instance identity rather than call count: what must not happen is a
     * SECOND resolution of a deferred `registerAll()` already resolved. The
     * packaged installers resolve their own proxies, which is the whole reason
     * a producer can be handed a dispatcher before the graph starts.
     */
    it("resolves none of the deferreds registerAll already resolved", async () => {
      // A pass-through spy: `mock.instances` is the receiving Deferred of each
      // call, which is what makes this an identity check rather than a count.
      const resolve = vi.spyOn(Deferred.prototype, "resolve");

      try {
        const legacy = buildLegacyRegistry();
        const appDeferreds = new Set<unknown>(resolve.mock.instances);
        resolve.mockClear();

        const composition = composeRoot(legacy);
        for (const installer of composition.featureInstallers) await installer.install();
        await composition.eventing.close();

        expect(appDeferreds.size).toBeGreaterThan(0);
        expect(resolve.mock.instances.length).toBeGreaterThan(0);
        expect(resolve.mock.instances.filter((deferred) => appDeferreds.has(deferred))).toEqual([]);
      } finally {
        resolve.mockRestore();
      }
    });
  });
});

/** The narrowing exists so the substrate reads without restating the refusal. */
describe("PackagedWorkerConsumerHandoff", () => {
  it("promises a group queue the eventing options can require", () => {
    const handoff: PackagedWorkerConsumerHandoff = requirePackagedWorkerConsumer({
      handoff: handoffWith(),
      clickHouseEnabled: true,
    });

    expect(handoff.substrate.groupQueue).toBeDefined();
  });
});
