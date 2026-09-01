import {
  InMemoryProcessStore,
  type EventSourcedQueueProcessor,
  type EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  createBlobMaintenancePipeline,
  createEventingRetentionConfiguration,
  EventingClickHouseEventStore,
  EventingServerRuntime,
  PrismaProcessStore,
} from "@langwatch/eventing/server";
import { ResourceScope } from "@langwatch/runtime-composition";
import { ProjectService } from "@langwatch/project-contract";
import { TraceTopicAssignmentPort, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { WorkerProductionComposition } from "../worker-production.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  TopicWorkerFeatureInstaller,
  type TopicWorkerCapability,
} from "../../features/topic/topic-worker-feature.installer";
import { TraceWorkerFeatureInstaller } from "../../features/trace/trace-worker-feature.installer";
import { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";

class Queue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

class Handle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async () => undefined);
}

class Transport extends WorkerTransportPort {
  readonly handle = new Handle();
  readonly start = vi.fn(async () => this.handle);
}

class Lifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async () => undefined);
}

class TopicCapability implements TopicWorkerCapability {
  readonly install = vi.fn();
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch = {
    recordTopics: vi.fn(async () => undefined),
    requestClustering: vi.fn(async () => undefined),
  };
}

class EventingTopicCapability implements TopicWorkerCapability {
  readonly install = vi.fn();
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch: TopicWorkerCapability["commandDispatch"];

  constructor(readonly commandSend = vi.fn(async () => undefined)) {
    this.commandDispatch = {
      recordTopics: async () => undefined,
      requestClustering: commandSend,
    };
  }
}

class TraceAssignments extends TraceTopicAssignmentPort {
  readonly assignTopic = vi.fn(async (_input: AssignTopicCommandData) => undefined);
}

class TraceInstaller {
  readonly install = vi.fn((_eventSourcing: EventSourcing) => ({
    traceAssignments: this.traceAssignments,
  }));

  constructor(private readonly traceAssignments: TraceTopicAssignmentPort) {}
}

function createProcessPersistenceDatabase() {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async <Result>(callback: (transaction: object) => Promise<Result>) =>
      callback({}),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  };
}

function createTraceFeature(eventing: WorkerEventingRuntime): {
  trace: TraceWorkerFeatureInstaller;
  installer: TraceInstaller;
} {
  const assignments = new TraceAssignments();
  const installer = new TraceInstaller(assignments);
  return {
    trace: TraceWorkerFeatureInstaller.create({ installer, eventing }),
    installer,
  };
}

class Projects extends ProjectService {
  tryFindInternal = unavailable<ProjectService["tryFindInternal"]>();
  ensureInternal = unavailable<ProjectService["ensureInternal"]>();
  isPresenceEnabled = unavailable<ProjectService["isPresenceEnabled"]>();
  getById = unavailable<ProjectService["getById"]>();
  getOrganizationId = unavailable<ProjectService["getOrganizationId"]>();
  tryGetOrganizationId = async (projectId: string): Promise<string | undefined> =>
    projectId === "project-1" ? "org-1" : undefined;
  tryGetIdentity = unavailable<ProjectService["tryGetIdentity"]>();
  tryGetById = unavailable<ProjectService["tryGetById"]>();
  tryGetSummaryById = unavailable<ProjectService["tryGetSummaryById"]>();
  getWithTeam = unavailable<ProjectService["getWithTeam"]>();
  tryGetWithTeam = unavailable<ProjectService["tryGetWithTeam"]>();
  create = unavailable<ProjectService["create"]>();
  update = unavailable<ProjectService["update"]>();
  archive = unavailable<ProjectService["archive"]>();
  listByOrganization = unavailable<ProjectService["listByOrganization"]>();
  listByTeam = unavailable<ProjectService["listByTeam"]>();
  listNamesByIds = unavailable<ProjectService["listNamesByIds"]>();
  listIdsByOrganization = unavailable<ProjectService["listIdsByOrganization"]>();
  listActiveByScopes = unavailable<ProjectService["listActiveByScopes"]>();
  updateMetadata = unavailable<ProjectService["updateMetadata"]>();
  touchCodingAgentSessionSeen = unavailable<ProjectService["touchCodingAgentSessionSeen"]>();
  touchCodingAgentPullRequestSeen =
    unavailable<ProjectService["touchCodingAgentPullRequestSeen"]>();
  searchByQuery = unavailable<ProjectService["searchByQuery"]>();
  tryGetTraceSharingConfig = unavailable<ProjectService["tryGetTraceSharingConfig"]>();
  resolveOrgAdmin = unavailable<ProjectService["resolveOrgAdmin"]>();
  resolveTraceDestination = unavailable<ProjectService["resolveTraceDestination"]>();
  tryGetTraceDestination = unavailable<ProjectService["tryGetTraceDestination"]>();
  listTraceDestinations = unavailable<ProjectService["listTraceDestinations"]>();
}

function unavailable<Method>(): Method {
  return (() => Promise.reject(new Error("Not used by this test"))) as Method;
}

class Configuration {
  tryForOrganization(organizationId: string) {
    if (organizationId !== "org-1") return null;
    return {
      proxyRoleArn: "proxy-role",
      bedrockRoleArn: "bedrock-role",
      proxyAwsAccessKeyId: "proxy-key",
      proxyAwsSecretAccessKey: "proxy-secret",
      bedrockProxyEndpoint: "bedrock.example.com",
      region: "us-east-1",
    };
  }
}

class Credentials {
  async assumeCustomerRole() {
    return {
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      sessionToken: "session-token",
    };
  }
}

/** A real registration, so the projection registry initializes its queues. */
function blobMaintenanceDefinition() {
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

describe("WorkerProductionComposition", () => {
  it("composes one canonical durable Eventing graph with consumers disabled", () => {
    const assignments = new TraceAssignments();
    const createServer = EventingServerRuntime.create.bind(EventingServerRuntime);
    const create = vi
      .spyOn(EventingServerRuntime, "create")
      .mockImplementation((options) => createServer(options));

    try {
      const composition = WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: async () => ({
            insert: async () => undefined,
            query: async () => ({ json: async () => [] }),
          }),
          groupQueue: { redis: {} as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        trace: { installer: new TraceInstaller(assignments) },
        topic: {
          database: {} as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ consumersEnabled: false }));
      expect(composition.eventing.eventStore).toBeInstanceOf(EventingClickHouseEventStore);
      expect(composition.eventing.processStore).toBeInstanceOf(PrismaProcessStore);
    } finally {
      create.mockRestore();
    }
  });

  it("carries the composition root's cross-pipeline projections into that graph", () => {
    // A global projection joins the shared job registry when the first
    // pipeline registers, not through an installer, so the only place it can
    // be supplied is the Eventing runtime's construction. Without this seam a
    // consumer of `event-sourcing/jobs` has no route for the SaaS billable
    // meter's jobs and rejects every one of them for redelivery.
    const composition = WorkerProductionComposition.create({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing: {
        database: createProcessPersistenceDatabase(),
        resolveClickHouseClient: async () => ({
          insert: async () => undefined,
          query: async () => ({ json: async () => [] }),
        }),
        groupQueue: { redis: {} as never },
        retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
      },
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      trace: { installer: new TraceInstaller(new TraceAssignments()) },
      topic: {
        database: {} as never,
        redis: null,
        execution: {} as never,
        metrics: {} as never,
      },
      globalProjections: {
        configure: (registry) => {
          registry.registerMapProjection({
            name: "orgBillableEventsMeter",
            eventTypes: ["lw.obs.trace.span_received"],
            map: (event) => ({ eventId: event.id }),
            store: { append: async () => void 0 },
          });
        },
      },
    });

    composition.eventing.eventSourcing.register(blobMaintenanceDefinition());

    expect([...composition.eventing.eventSourcing.globalJobRegistry.keys()]).toContain(
      "global:handler:orgBillableEventsMeter",
    );
  });

  it("installs Topic's producer graph and boot seeds without claiming the shared Eventing queue", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const traceFeature = createTraceFeature(eventing);
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: traceFeature.trace.traceAssignments,
    });
    const transport = new Transport();
    const lifecycle = new Lifecycle();
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle,
      transport,
      trace: traceFeature.trace,
      topic,
      enterprise: {
        managedProvider: {
          projects: new Projects(),
          configuration: new Configuration(),
          credentials: new Credentials(),
        },
      },
    });

    await composition.application.start();

    expect(capability.install).toHaveBeenCalledWith({
      eventSourcing: eventing.eventSourcing,
      traceAssignments: expect.any(Object),
    });
    expect(capability.startBootSeeds).toHaveBeenCalledOnce();
    expect(traceFeature.installer.install).toHaveBeenCalledBefore(capability.install);
    expect(capability.install).toHaveBeenCalledBefore(queue.waitUntilReady);
    expect(capability.startBootSeeds).toHaveBeenCalledBefore(queue.waitUntilReady);
    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(transport.start).toHaveBeenCalledOnce();

    await composition.topic.requestManualRun("project-1", 123);

    expect(capability.commandDispatch.requestClustering).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 123,
      trigger: "manual",
    });
    await expect(
      composition.enterprise?.managedProviders?.buildLitellmParameters({
        params: { api_key: "customer-key" },
        projectId: "project-1",
        model: "anthropic.claude-3-sonnet",
        modelProvider: { provider: "bedrock" },
      }),
    ).resolves.toMatchObject({
      aws_access_key_id: "access-key",
      aws_bedrock_runtime_endpoint: "http://bedrock.example.com",
    });

    await composition.application.close();

    expect(transport.handle.shutdown).toHaveBeenCalledOnce();
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("installs Trace before Topic and passes Topic Trace's canonical assignment port", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const traceFeature = createTraceFeature(eventing);
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: traceFeature.trace.traceAssignments,
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      trace: traceFeature.trace,
      topic,
    });

    await composition.application.start();

    expect(traceFeature.installer.install).toHaveBeenCalledWith(eventing.eventSourcing);
    expect(capability.install).toHaveBeenCalledWith({
      eventSourcing: eventing.eventSourcing,
      traceAssignments: traceFeature.trace.traceAssignments,
    });
    expect(traceFeature.installer.install.mock.invocationCallOrder[0]).toBeLessThan(
      capability.install.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("routes manual Topic dispatch through the Eventing command sender", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const traceFeature = createTraceFeature(eventing);
    const capability = new EventingTopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: traceFeature.trace.traceAssignments,
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      trace: traceFeature.trace,
      topic,
    });

    await composition.application.start();
    await composition.topic.requestManualRun("project-1", 456);

    expect(capability.commandSend).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 456,
      trigger: "manual",
    });

    await composition.application.close();
  });

  it("does not close a parent resource scope from the production composition", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumers: { enabled: false },
    });
    const traceFeature = createTraceFeature(eventing);
    const resources = new ResourceScope();
    const closeResource = vi.fn();
    resources.own("parent", closeResource);
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: traceFeature.trace.traceAssignments,
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      trace: traceFeature.trace,
      topic,
      resources,
    });

    await composition.application.start();
    await composition.application.close();

    expect(closeResource).not.toHaveBeenCalled();
    await resources.close();
    expect(closeResource).toHaveBeenCalledOnce();
  });
});
