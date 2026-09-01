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

  /**
   * The API-key sweep is the first feature composed here from its own package
   * rather than handed over built, so these two say what "composed" means: the
   * pipeline is registered by this graph, and the revoke behind its schedule
   * reaches the client this root was given. A sweep wired to the wrong client —
   * or to nothing — registers exactly the same routing keys and retires nothing.
   */
  describe("when the API-key sweep is composed", () => {
    function compositionWith(database: object, topicDatabase: object) {
      return WorkerProductionComposition.create({
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
          database: topicDatabase as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
        ...(Object.keys(database).length > 0 ? { database: database as never } : {}),
      });
    }

    async function sweepThrough(composition: WorkerProductionComposition) {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "api-key",
      );
      expect(installer, "the composition mounted no API-key feature").toBeDefined();
      const registered: { name: string; run: (...args: never[]) => Promise<void> }[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push({
          name: definition.metadata.name,
          run: definition.processManagers.get("agentSandboxKeyReap")!.config.intents!.reap!
            .run as never,
        });
        return {} as never;
      });
      await installer!.install();
      expect(registered.map((entry) => entry.name)).toEqual(["agent_sandbox_maintenance"]);
      await registered[0]!.run(...([{ scheduledFor: 0 }, {}] as never[]));
    }

    /** @scenario "The worker composes the sandbox sweep from the feature package" */
    it("revokes through the client the root was given", async () => {
      const updateMany = vi.fn(async () => ({ count: 0 }));
      const unused = vi.fn(async () => ({ count: 0 }));

      await sweepThrough(
        compositionWith({ apiKey: { updateMany } }, { apiKey: { updateMany: unused } }),
      );

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(unused).not.toHaveBeenCalled();
    });

    /**
     * The fallback the platform composition root still relies on: it hands its
     * one Prisma client over inside `topic` and names no `database`.
     */
    it("falls back to the client Topic was given when no database is named", async () => {
      const updateMany = vi.fn(async () => ({ count: 0 }));

      await sweepThrough(compositionWith({}, { apiKey: { updateMany } }));

      expect(updateMany).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The GitHub branch sweep, composed here rather than handed over built.
   *
   * It mounts whether or not this deployment is a GitHub App, because its
   * retention half is a DELETE over rows this process wrote and needs no
   * credentials at all. What credentials decide is whether the recheck half can
   * ask GitHub anything — and a deployment that expected pull-request linkage
   * to keep working has to be able to read that in its own logs at boot, not
   * infer it from a sweep that quietly answers zero forever.
   */
  describe("when the GitHub branch sweep is composed", () => {
    function compositionWith(input: {
      source?: Record<string, unknown>;
      database?: object;
      observability?: object;
    }) {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...input.source }),
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
          database: (input.database ?? {}) as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
        ...(input.observability ? { observability: input.observability as never } : {}),
      });
    }

    async function recheckThrough(composition: WorkerProductionComposition) {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "github",
      );
      expect(installer, "the composition mounted no GitHub feature").toBeDefined();
      const registered: { name: string; run: (...args: never[]) => Promise<void> }[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push({
          name: definition.metadata.name,
          run: definition.processManagers.get("githubBranchRecheck")!.config.intents!.recheck!
            .run as never,
        });
        return {} as never;
      });
      await installer!.install();
      expect(registered.map((entry) => entry.name)).toEqual(["github_maintenance"]);
      await registered[0]!.run(...([{ scheduledFor: 0 }, {}] as never[]));
    }

    it("re-checks through the client the root was given", async () => {
      const findMany = vi.fn(async () => []);

      await recheckThrough(
        compositionWith({ database: { githubBranchPullRequestCheck: { findMany } } }),
      );

      expect(findMany).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A worker without GitHub App credentials names the missing capability" */
    it("names the absent App credentials, and mounts the sweep anyway", async () => {
      const warn = vi.fn();
      const findMany = vi.fn(async () => []);

      await recheckThrough(
        compositionWith({
          database: { githubBranchPullRequestCheck: { findMany } },
          observability: { logger: { info: vi.fn(), warn } },
        }),
      );

      expect(warn).toHaveBeenCalledWith(
        { reason: "no-github-app-credentials" },
        expect.stringContaining("without App credentials"),
      );
    });

    it("says nothing when the process is a GitHub App", async () => {
      const warn = vi.fn();

      await recheckThrough(
        compositionWith({
          source: { GITHUB_LANGY_APP_ID: "1234", GITHUB_LANGY_PRIVATE_KEY: "-----BEGIN-----" },
          database: { githubBranchPullRequestCheck: { findMany: vi.fn(async () => []) } },
          observability: { logger: { info: vi.fn(), warn } },
        }),
      );

      expect(warn).not.toHaveBeenCalled();
    });
  });

  /**
   * The Langy session-key sweep, composed here rather than handed over built.
   *
   * The reaper was written, tested and routed for cron, and then never
   * scheduled, because the chart ships no CronJobs — so for the whole time it
   * existed the backstop for keys orphaned by a SIGKILLed manager had no caller
   * at all. What these cases hold is that the pipeline is registered by THIS
   * graph and that the revoke behind its schedule reaches the client this root
   * was given. A sweep wired to the wrong client — or to nothing — registers
   * exactly the same routing keys and retires nothing.
   */
  describe("when the Langy session-key sweep is composed", () => {
    function compositionWith(database: object, topicDatabase: object) {
      return WorkerProductionComposition.create({
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
          database: topicDatabase as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
        ...(Object.keys(database).length > 0 ? { database: database as never } : {}),
      });
    }

    async function sweepThrough(composition: WorkerProductionComposition) {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "langy-maintenance",
      );
      expect(installer, "the composition mounted no Langy maintenance feature").toBeDefined();
      const registered: { name: string; run: (...args: never[]) => Promise<void> }[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push({
          name: definition.metadata.name,
          run: definition.processManagers.get("langySessionKeyReap")!.config.intents!.reap!
            .run as never,
        });
        return {} as never;
      });
      await installer!.install();
      expect(registered.map((entry) => entry.name)).toEqual(["langy_maintenance"]);
      await registered[0]!.run(...([{ scheduledFor: 0 }, {}] as never[]));
    }

    /** @scenario "The worker composes the session-key sweep from the feature package" */
    it("revokes through the client the root was given", async () => {
      const updateMany = vi.fn(async () => ({ count: 0 }));
      const unused = vi.fn(async () => ({ count: 0 }));

      await sweepThrough(
        compositionWith({ apiKey: { updateMany } }, { apiKey: { updateMany: unused } }),
      );

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(unused).not.toHaveBeenCalled();
    });

    /** @scenario "The session-key sweep revokes only elapsed Langy session keys" */
    it("sweeps only the reserved Langy session name", async () => {
      const updateMany = vi.fn(async (_update: { where: { name: string } }) => ({ count: 0 }));

      await sweepThrough(compositionWith({ apiKey: { updateMany } }, {}));

      expect(updateMany.mock.calls[0]![0].where.name).toBe("Langy session");
    });

    /**
     * The fallback the platform composition root still relies on: it hands its
     * one Prisma client over inside `topic` and names no `database`.
     */
    it("falls back to the client Topic was given when no database is named", async () => {
      const updateMany = vi.fn(async () => ({ count: 0 }));

      await sweepThrough(compositionWith({}, { apiKey: { updateMany } }));

      expect(updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
