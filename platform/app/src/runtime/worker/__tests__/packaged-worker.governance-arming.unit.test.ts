/**
 * Governance's ingestion pull, across the two Eventing graphs the switched
 * worker holds.
 *
 * Governance is the one feature that registers through a `register()` of its
 * own rather than by handing a definition across, and that method does more
 * than register: it builds the durable pull lifecycle and reconciles it. After
 * the cutover it runs TWICE in one process — once from the App's `registerAll()`
 * and once from the packaged composition's `governanceIngestion` installer, both
 * over the very same `AppGovernanceEventingRuntime` the handoff carries. The
 * risk that buys is a side effect performed twice, and the plan's answer is that
 * the passive App-side `ProcessRuntime` never loops.
 *
 * That answer is a claim about code nothing asserted. `worker-pipeline-parity`
 * stubs `governanceRuntime` wholesale, so it registers a governance-shaped
 * nothing; `packaged-worker.composition` stands in for the whole
 * `EventingServerRuntime` and never reaches a process manager's workers. So
 * this file builds both graphs for real around the real adapter and watches the
 * only thing that can tell them apart — which of the two process stores gets
 * polled:
 *
 *   ProcessRuntime.registerPipeline
 *     ├─ consumersEnabled  → wakeWorker.start()   → store.findDueWakes(...)  ── the loop
 *     │                    → outboxWorker.start() → store.leaseDueMessages()
 *     └─ !consumersEnabled → neither is ever started
 *
 * The wake loop is what turns a durable `nextWakeAt` into a pull. Two of them in
 * one process is two pods' worth of pulling from one pod; the App having none is
 * what makes registering governance on both graphs safe.
 */
import {
  AppGovernanceEventingAdapter,
  AppGovernanceEventingRuntime,
  AppIngestionPullExecutionRuntime,
  AppIngestionPullLifecycleRuntime,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import type {
  IngestionPullLifecycleDatabase,
  IngestionPullLifecycleSource,
} from "@langwatch/enterprise-governance-server";
import {
  EventSourcing,
  InMemoryProcessStore,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingServerRuntime,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { WorkerEventingRuntime } from "@langwatch/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  packagedWorkerEventing,
  requirePackagedWorkerConsumer,
} from "~/runtime/worker/packaged-worker.capabilities";
import type {
  WorkerEventingHandoff,
  WorkerEventingSubstrate,
} from "~/server/app-layer/worker-eventing-handoff";
import { autoStub } from "./legacy-registry.fixture";

/** A cron the contract accepts, so `configure` is not rejected as unschedulable. */
const PULL_CRON = "*/5 * * * *";

/** The one ingestion source reconciliation finds. */
const SOURCE: IngestionPullLifecycleSource = {
  id: "source-1",
  organizationId: "org-1",
  status: "active",
  pullSchedule: PULL_CRON,
  pollerCursor: null,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  archivedAt: null,
};

/** Postgres, reduced to the three reads reconciliation performs. */
function lifecycleDatabase(): IngestionPullLifecycleDatabase {
  return {
    project: { findMany: async () => [{ id: "project-1" }] },
    processManagerInstance: { findMany: async () => [] },
    ingestionSource: { findMany: async () => [SOURCE] },
  };
}

/** One job the queue was asked to carry, by its routing key. */
type RecordedSend = string;

/**
 * A queue that records and never delivers.
 *
 * Delivering would run the pipelines, and this file is not asking what the
 * ingestion-pull process does with a `configure` — it is asking which runtime
 * started a loop. Recording keeps the graph inert while still counting every
 * dispatch either graph makes.
 */
function recordingQueueFactory(recorded: RecordedSend[]) {
  return (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    send: async (payload) => {
      recorded.push(
        `${String(payload.__pipelineName)}:${String(payload.__jobType)}:${String(payload.__jobName)}`,
      );
    },
    sendBatch: async () => undefined,
    waitUntilReady: async () => undefined,
    close: async () => undefined,
  });
}

/** The App's substrate, as the handoff carries it. */
function appSubstrate(): WorkerEventingSubstrate {
  return {
    prisma: autoStub(),
    resolveClickHouseClient: autoStub(),
    groupQueue: { redis: autoStub() },
    persistenceRetention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
    retentionPolicyResolver: autoStub(),
    replayMarkerChecker: undefined,
  };
}

/** What one graph dispatched, and the store spies that say whether it looped. */
type Graph = {
  name: "app" | "packaged";
  sends: RecordedSend[];
  findDueWakes: ReturnType<typeof vi.spyOn>;
  leaseDueMessages: ReturnType<typeof vi.spyOn>;
  eventSourcing: EventSourcing;
};

/**
 * The worker process after the switch: one App graph, one packaged graph, and
 * ONE governance runtime shared between them — the object the handoff carries,
 * whose `runsWorkers` says this process runs the worker's responsibilities.
 *
 * `appConsumersEnabled` is the only knob, because it is the only thing the
 * cutover changes about the App: `eventingConsumers: "external"` makes it false,
 * and everything below asks what that buys.
 */
function buildWorkerProcess(options: { appConsumersEnabled: boolean }) {
  const eventStore = EventStoreMemory.createForTesting();

  const appStore = InMemoryProcessStore.createForTesting();
  const appSends: RecordedSend[] = [];
  const appEs = new EventSourcing({
    enabled: true,
    eventStore,
    processStore: appStore,
    queueFactory: recordingQueueFactory(appSends),
    consumersEnabled: options.appConsumersEnabled,
    executionTarget: "worker",
  });

  // The packaged graph, built through the production mapper: the App hands its
  // substrate across and this is the composition that asks for consumers.
  const packagedStore = InMemoryProcessStore.createForTesting();
  const packagedSends: RecordedSend[] = [];
  const handoff: WorkerEventingHandoff = {
    appOwnsEventingConsumers: false,
    isSaas: false,
    capabilities: autoStub(),
    substrate: appSubstrate(),
    topic: autoStub(),
  };
  const serverRuntime = vi.spyOn(EventingServerRuntime, "create").mockImplementation(
    () =>
      ({
        dependencies: () => ({
          eventStore,
          processStore: packagedStore,
          queueFactory: recordingQueueFactory(packagedSends),
        }),
      }) as unknown as EventingServerRuntime,
  );
  let packaged: WorkerEventingRuntime;
  try {
    const { consumers, ...persistence } = packagedWorkerEventing(
      requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true }),
    );
    packaged = WorkerEventingRuntime.createProduction({
      persistence,
      consumers,
      warnWhenProjectionsRunInline: false,
    });
  } finally {
    serverRuntime.mockRestore();
  }

  // Installed before either registration, because a wake worker scans the
  // instant it starts — an assertion set up afterwards would miss the loop it
  // exists to catch.
  const graphs: Graph[] = [
    {
      name: "app",
      sends: appSends,
      findDueWakes: vi.spyOn(appStore, "findDueWakes"),
      leaseDueMessages: vi.spyOn(appStore, "leaseDueMessages"),
      eventSourcing: appEs,
    },
    {
      name: "packaged",
      sends: packagedSends,
      findDueWakes: vi.spyOn(packagedStore, "findDueWakes"),
      leaseDueMessages: vi.spyOn(packagedStore, "leaseDueMessages"),
      eventSourcing: packaged.eventSourcing,
    },
  ];

  const governance = AppGovernanceEventingRuntime.create(
    AppIngestionPullExecutionRuntime.create(
      // Reached only by an intent a wake commits, and nothing here lets a wake
      // fire: the queue records without delivering, so no `configure` is ever
      // applied and no `nextWakeAt` is ever written.
      autoStub(),
      undefined,
      { count: () => undefined, observeDuration: () => undefined },
    ),
    AppIngestionPullLifecycleRuntime.create(
      lifecycleDatabase(),
      { ensureInternal: async () => ({ id: "governance-tenant" }) } as never,
      { nextRunAt: ({ after }) => after + 300_000 },
      // The process fact, not the consumer fact: P3 deliberately left this
      // keyed on the role, so both graphs reconcile in a worker process.
      true,
    ),
  );

  return {
    graph: (name: Graph["name"]) => graphs.find((candidate) => candidate.name === name)!,

    /**
     * Registers governance on both graphs, in the order the process does it:
     * the App's `registerAll()` runs inside `initializeWorkerApp`, and the
     * packaged installer runs afterwards, on the App's own runtime object.
     */
    registerBothGraphs(): void {
      for (const graph of graphs) {
        AppGovernanceEventingAdapter.create(graph.eventSourcing, governance).register();
      }
    },

    /** Which graphs started a wake loop, in registration order. */
    graphsRunningWakeLoops(): string[] {
      return graphs
        .filter((graph) => graph.findDueWakes.mock.calls.length > 0)
        .map((graph) => graph.name);
    },

    /** Which graphs started an outbox dispatcher, in registration order. */
    graphsRunningOutboxLoops(): string[] {
      return graphs
        .filter((graph) => graph.leaseDueMessages.mock.calls.length > 0)
        .map((graph) => graph.name);
    },

    async close(): Promise<void> {
      await packaged.close().catch(() => undefined);
      await appEs.close().catch(() => undefined);
    },
  };
}

type WorkerProcess = ReturnType<typeof buildWorkerProcess>;

/** Every `configure` command a graph dispatched — the arming, as a job. */
function armingCommands(graph: Graph): RecordedSend[] {
  return graph.sends.filter((key) => key.endsWith(":command:configure"));
}

describe("packaged worker governance arming", () => {
  let world: WorkerProcess;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await world?.close();
    vi.restoreAllMocks();
  });

  describe("given the packaged graph consuming and the App producer-only", () => {
    /**
     * The load-bearing one. `AppGovernanceEventingAdapter.register()` runs on
     * both graphs, so the ingestion-pull process manager is mounted twice in
     * one process — and exactly one of those mounts starts the loop that turns
     * a due `nextWakeAt` into a pull, because `ProcessRuntime` starts its wake
     * worker only where consumers are enabled.
     */
    it("runs the ingestion-pull wake loop on the packaged graph alone", () => {
      world = buildWorkerProcess({ appConsumersEnabled: false });

      world.registerBothGraphs();

      expect(world.graphsRunningWakeLoops()).toEqual(["packaged"]);
    });

    /**
     * The outbox is the other half of the same decision, and half of it is a
     * graph that claims the queue and never drains its own process managers —
     * or an App that drains intents for a graph it does not consume for.
     */
    it("runs the ingestion-pull outbox dispatcher on the packaged graph alone", () => {
      world = buildWorkerProcess({ appConsumersEnabled: false });

      world.registerBothGraphs();

      expect(world.graphsRunningOutboxLoops()).toEqual(["packaged"]);
    });

    /**
     * The passive App is not merely quieter: it polls its process store not
     * once. Stated as a bare zero because "fewer scans" would still be a second
     * pod's worth of wake handling racing the first for every due pull.
     */
    it("leaves the App's process store unpolled", () => {
      world = buildWorkerProcess({ appConsumersEnabled: false });

      world.registerBothGraphs();

      expect(world.graph("app").findDueWakes).not.toHaveBeenCalled();
      expect(world.graph("app").leaseDueMessages).not.toHaveBeenCalled();
      expect(world.graph("packaged").findDueWakes).toHaveBeenCalled();
    });

    /**
     * What the App DOES still do, pinned so the switch commit cannot change it
     * unseen. Reconciliation is keyed on `roleRunsWorkers` rather than on
     * consumer ownership, so both graphs re-send the same `configure` for every
     * live source. That is safe and not accidental: the two commands carry the
     * same `configVersion` and land on one queue with one consumer, and the
     * process settles both to the same cron slot. It is the wake LOOP above
     * that must not double, not the command that arms it.
     */
    it("has both graphs re-send the arming command onto the one queue", async () => {
      world = buildWorkerProcess({ appConsumersEnabled: false });

      world.registerBothGraphs();

      await vi.waitFor(() => {
        expect(armingCommands(world.graph("app"))).toHaveLength(1);
        expect(armingCommands(world.graph("packaged"))).toHaveLength(1);
      });
    });
  });

  describe("given the packaged graph beside an App that kept its consumers", () => {
    /**
     * The configuration `requirePackagedWorkerConsumer` refuses to boot,
     * reproduced here to show what it is refusing: two wake loops over the same
     * durable schedule, in one process, each free to claim the same due pull.
     * The refusal is asserted in `packaged-worker.composition`; this is why it
     * exists.
     */
    it("would run the wake loop twice", () => {
      world = buildWorkerProcess({ appConsumersEnabled: true });

      world.registerBothGraphs();

      expect(world.graphsRunningWakeLoops()).toEqual(["app", "packaged"]);
    });
  });
});
