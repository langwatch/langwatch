import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTenantId,
  InMemoryProcessStore,
  type AppendStore,
  type EventSourcedQueueProcessor,
  type EventSourcing,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  createBlobMaintenancePipeline,
  createEventingRetentionConfiguration,
  EventingClickHouseEventStore,
  EventingServerRuntime,
  PrismaProcessStore,
} from "@langwatch/eventing/server";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { point } from "@langwatch/metric-server/testing";
import { ResourceScope } from "@langwatch/runtime-composition";
import { ProjectService } from "@langwatch/project-contract";
import { TraceTopicAssignmentPort, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import {
  saasBillableEventsMeter,
  WorkerProductionComposition,
} from "../worker-production.composition";
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

function canonicalLogRecord(): CanonicalLogRecord {
  return {
    tenantId: "project_alpha",
    organizationId: "organization_test",
    recordId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: "1",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "b".repeat(32),
    correlationSpanId: "c".repeat(16),
    correlationSource: "claude_synthesized",
    timeUnixNano: "1700000000000000000",
    observedTimeUnixNano: "0",
    timeUnixMs: 1_700_000_000_000,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: '{"type":"string","value":"hello"}',
    bodyText: "hello",
    attributesJson: "[]",
    attributesFlatJson: '{"event.name":"api_request"}',
    attributeKeys: ["event.name"],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "api_request",
    providerKind: "claude_code",
    providerEventKind: "model",
    providerEventSequence: "1",
    providerSessionId: "session",
    providerConversationId: "",
    providerPromptId: "prompt",
    piiRedactionLevel: "ESSENTIAL",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
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

  describe("given the SaaS deployment leaf this process reads for itself", () => {
    /**
     * The routing keys the checked-in job registry says the cross-pipeline pair
     * carries. Read rather than restated: `job-registry.json` is the switch's
     * checklist for what the packaged consumer must be able to route, and a
     * literal here would only ever assert this file against itself.
     */
    function expectedGlobalRoutingKeys(): string[] {
      const registry = JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), "../../features/job-registry.json"),
          "utf8",
        ),
      ) as { globalProjections: { pipeline: string; jobs: string[] } };
      return registry.globalProjections.jobs
        .map((job) => `${registry.globalProjections.pipeline}:${job}`)
        .sort();
    }

    function compositionFor(
      source: Record<string, unknown>,
      options: { billingReporting?: boolean } = {},
    ): WorkerProductionComposition {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...source }),
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
        ...(options.billingReporting === false
          ? {}
          : {
              billingReporting: {
                // Never built: these cases read what the runtime's own
                // construction registers, and the reporting pipeline registers
                // at install time.
                installer: {
                  buildProcessing: () => {
                    throw new Error("billing reporting is not installed in this case");
                  },
                  connectSelfDispatch: () => void 0,
                },
              },
            }),
      });
    }

    function globalRoutingKeys(composition: WorkerProductionComposition): string[] {
      composition.eventing.eventSourcing.register(blobMaintenanceDefinition());
      return [...composition.eventing.eventSourcing.globalJobRegistry.keys()]
        .filter((key) => key.startsWith("global:"))
        .sort();
    }

    /**
     * A global projection joins the shared job registry when the first pipeline
     * registers, not through an installer, so the only place it can be
     * configured is the Eventing runtime's construction. This graph builds the
     * pair itself now rather than receiving it, and a consumer of
     * `event-sourcing/jobs` without a route for the meter's jobs rejects every
     * one of them for redelivery while every health signal stays green.
     */
    /** @scenario "A worker mounts the meter only where the deployment is SaaS" */
    it("mounts the billable-events meter pair a SaaS install produces into", () => {
      expect(globalRoutingKeys(compositionFor({ IS_SAAS: "true" }))).toEqual(
        expectedGlobalRoutingKeys(),
      );
    });

    /**
     * The other direction of the same fact. A self-hosted App configures no
     * meter, so a worker that mounted one anyway would write a billable row per
     * span into a table nobody bills from and dispatch a monthly report command
     * per project that no Stripe customer answers.
     */
    /** @scenario "A worker mounts the meter only where the deployment is SaaS" */
    it("mounts neither where the deployment is not SaaS", () => {
      expect(globalRoutingKeys(compositionFor({}))).toEqual([]);
    });

    /**
     * The meter is organization-keyed, and the tenant-keyed resolver this
     * process already holds answers it because the routing directory behind it
     * treats an organization id as a tenant of itself. Asking it for the
     * TENANT instead would still return a client and still insert a row — into
     * the shared instance, for a customer whose data belongs on their own
     * cluster. Nothing downstream notices, so the pin is here.
     */
    /** @scenario "A worker routes the meter by organization, not by tenant" */
    it("resolves the meter's ClickHouse client for the organization, not the tenant", async () => {
      const resolveClickHouseClient = vi.fn(async () => ({ insert: async () => undefined }));
      const registered: { store?: AppendStore<{ tenantId: string }> } = {};
      saasBillableEventsMeter({
        database: {
          project: { findUnique: async () => ({ team: { organizationId: "org_private" } }) },
        } as never,
        redis: { get: async () => null, setex: async () => "OK" } as never,
        resolveClickHouseClient: resolveClickHouseClient as never,
        getDispatch: () => async () => void 0,
      })({
        registerMapProjection: (projection: { store: AppendStore<{ tenantId: string }> }) => {
          registered.store = projection.store;
        },
        registerMapSubscriber: () => void 0,
      } as never);

      await registered.store?.append({ tenantId: "project_alpha" } as never, {} as never);

      expect(resolveClickHouseClient).toHaveBeenCalledWith("org_private");
      expect(resolveClickHouseClient).not.toHaveBeenCalledWith("project_alpha");
    });

    /**
     * The reports the meter's dispatch subscriber asks for are sent by the
     * billing reporting pipeline, which this same composition registers. A
     * SaaS graph without it would count every billable event correctly and
     * report none of them: revenue present in ClickHouse, absent from Stripe,
     * and visible nowhere else.
     */
    /** @scenario "A SaaS worker refuses to meter without a pipeline to report through" */
    it("refuses to meter where it composed no pipeline to report through", () => {
      expect(() => compositionFor({ IS_SAAS: "true" }, { billingReporting: false })).toThrow(
        /billing reporting pipeline/,
      );
    });
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

    it("says nothing about credentials when the process is a GitHub App", async () => {
      const warn = vi.fn();

      await recheckThrough(
        compositionWith({
          source: { GITHUB_LANGY_APP_ID: "1234", GITHUB_LANGY_PRIVATE_KEY: "-----BEGIN-----" },
          database: { githubBranchPullRequestCheck: { findMany: vi.fn(async () => []) } },
          observability: { logger: { info: vi.fn(), warn } },
        }),
      );

      // Scoped to GitHub's reason rather than to the logger: this graph
      // supplies no Coding Agent pipeline, and that absence is declared here
      // too. A bare "never warned" would pass only until the next honest
      // declaration and then fail for a reason that has nothing to do with
      // GitHub credentials.
      expect(warn).not.toHaveBeenCalledWith(
        { reason: "no-github-app-credentials" },
        expect.anything(),
      );
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

  /**
   * Metric and Log, composed here rather than handed over built.
   *
   * Both pipelines were the App's to build: their repository carried an
   * organization-keyed ClickHouse read (metric) and a trace read cap (log)
   * that durable processing never touches, and this process can supply
   * neither. What these cases hold is that the pipelines are composed by THIS
   * graph, from the tenant-keyed client and retention its Eventing substrate
   * already resolved, and that the ADR-056 edge into Coding Agent is either
   * mounted or declared missing by name. A pipeline wired to the wrong client
   * registers exactly the same routing keys and stores nothing.
   */
  describe("when metric and log processing are composed", () => {
    function compositionWith(
      input: {
        resolveClickHouseClient?: (tenantId: string) => Promise<unknown>;
        source?: Record<string, unknown>;
        observability?: object;
        codingAgent?: boolean;
      } = {},
    ) {
      const commands = {
        contributeSpanFacts: vi.fn(async () => undefined),
        contributeMetricFacts: vi.fn(async () => undefined),
        contributeLogFacts: vi.fn(async () => undefined),
      };
      const composition = WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...input.source }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: (input.resolveClickHouseClient ??
            (async () => ({
              insert: async () => undefined,
              query: async () => ({ json: async () => [] }),
            }))) as never,
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
        ...(input.codingAgent
          ? {
              codingAgent: {
                installer: {
                  buildProcessing: () =>
                    ({
                      metadata: { name: "coding_agent_processing", aggregateType: "codingAgent" },
                      commands: [],
                      processManagers: new Map(),
                    }) as never,
                },
              },
            }
          : {}),
        ...(input.observability ? { observability: input.observability as never } : {}),
      });
      return { composition, commands };
    }

    function definitionsFrom(composition: WorkerProductionComposition, feature: string) {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === feature,
      );
      expect(installer, `the composition mounted no ${feature} feature`).toBeDefined();
      const registered: { name: string; subscribers: string[] }[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push({
          name: definition.metadata.name,
          subscribers: [...definition.eventSubscribers.keys()],
        });
        return { commands: {} } as never;
      });
      return { installer: installer!, registered };
    }

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("mounts both pipelines from this graph's own ClickHouse client", async () => {
      const { composition } = compositionWith();

      for (const feature of ["metric", "log"] as const) {
        const { installer, registered } = definitionsFrom(composition, feature);
        await installer.install();
        expect(registered.map((entry) => entry.name)).toEqual([
          feature === "metric" ? "metric_processing" : "log_processing",
        ]);
      }
    });

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it.each([
      ["metric", () => point({ tenantId: "project_alpha", timeUnixMs: 1_800_000_000_000 })],
      ["log", () => canonicalLogRecord()],
    ] as const)(
      "appends %s rows through the ClickHouse client this graph resolved",
      async (feature, row) => {
        const insert = vi.fn(async (_request: { values: readonly unknown[] }) => undefined);
        const resolveClickHouseClient = vi.fn(async () => ({
          insert,
          query: async () => ({ json: async () => [] }),
        }));
        const { composition } = compositionWith({ resolveClickHouseClient });
        const stores: AppendStore<never>[] = [];
        const eventSourcing = composition.eventing.eventSourcing;
        vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
          for (const entry of definition.mapProjections.values()) {
            stores.push((entry.definition as unknown as { store: AppendStore<never> }).store);
          }
          return { commands: {} } as never;
        });
        await composition.featureInstallers
          .find((candidate) => candidate.name === feature)!
          .install();

        await stores[0]!.append(row() as never, { retentionPolicy: undefined } as never);

        // The client this composition resolved, for the tenant the row names.
        // A pipeline handed any other client registers the identical routing
        // keys and writes its rows somewhere nothing reads.
        expect(resolveClickHouseClient).toHaveBeenCalledWith("project_alpha");
        // 49 is the substrate's own `retention.defaultRetentionDays` above,
        // not a number configured a second time here. Two graphs stamping
        // different retentions on the same table expire each other's rows.
        expect(insert.mock.calls[0]![0].values[0]).toMatchObject({ _retention_days: 49 });
      },
    );

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("mounts the coding-agent dispatch subscribers when that pipeline is present", async () => {
      const { composition } = compositionWith({ codingAgent: true });

      const metric = definitionsFrom(composition, "metric");
      await metric.installer.install();
      const log = definitionsFrom(composition, "log");
      await log.installer.install();

      expect(metric.registered[0]!.subscribers).toEqual(["codingAgentMetricFactsDispatch"]);
      expect(log.registered[0]!.subscribers).toEqual(["codingAgentLogFactsDispatch"]);
    });

    /** @scenario "A worker without the Coding Agent pipeline names the missing edge" */
    it("names the absent Coding Agent pipeline, and mounts both anyway", async () => {
      const warn = vi.fn();

      const { composition } = compositionWith({
        observability: { logger: { info: vi.fn(), warn } },
      });

      expect(warn).toHaveBeenCalledWith(
        { reason: "no-coding-agent-pipeline" },
        expect.stringContaining("without the Coding Agent pipeline"),
      );
      expect(composition.featureInstallers.map((installer) => installer.name)).toEqual(
        expect.arrayContaining(["metric", "log"]),
      );
    });

    /** @scenario "A worker without the Coding Agent pipeline names the missing edge" */
    it("says nothing about the edge when the Coding Agent pipeline is present", () => {
      const warn = vi.fn();

      compositionWith({
        codingAgent: true,
        observability: { logger: { info: vi.fn(), warn } },
      });

      expect(warn).not.toHaveBeenCalledWith(
        { reason: "no-coding-agent-pipeline" },
        expect.anything(),
      );
    });

    /** @scenario "Producer and consumer clamp one lane count" */
    it("shards the command lanes on the same variables the App reads", async () => {
      const { composition } = compositionWith({
        source: { METRIC_PROCESSING_SHARDS: "4", LOG_PROCESSING_SHARDS: "2" },
      });
      const lanes = new Map<string, Set<string>>();
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        for (const command of definition.commands) {
          const seen = new Set<string>();
          // Enough distinct identities that every lane a shard count of 4 or
          // 2 can produce is reached; the ids are fixed, so the hash and the
          // lanes it yields are the same on every run.
          for (let index = 0; index < 64; index += 1) {
            const id = index.toString(16).padStart(64, "0");
            seen.add(
              command.options!.getGroupKey!({ pointId: id, recordId: id } as never) as string,
            );
          }
          lanes.set(definition.metadata.name, seen);
        }
        return { commands: {} } as never;
      });
      for (const feature of ["metric", "log"] as const) {
        await composition.featureInstallers
          .find((candidate) => candidate.name === feature)!
          .install();
      }

      // The exact lane sets the two variables ask for. A composition that
      // ignored them would answer with the eight-lane metric default and the
      // sixteen-lane log default instead, and both are supersets of these.
      expect([...lanes.get("metric_processing")!].sort()).toEqual([
        "metric:0",
        "metric:1",
        "metric:2",
        "metric:3",
      ]);
      expect([...lanes.get("log_processing")!].sort()).toEqual(["log:0", "log:1"]);
    });
  });

  /**
   * Suite-run processing, composed here rather than handed over built.
   *
   * The pipeline itself was never the App's to own — it folds three commands
   * into one ClickHouse table — but its fold store was assembled from three
   * places at once (the projection store on the suite runtime, the version in
   * the contract, the Redis cache on the registry), so no other process could
   * put one together. What these cases hold is that THIS graph assembles it,
   * from the tenant-keyed client, the retention and the Redis its own
   * substrate already resolved, and that the cache lands in the keyspace the
   * App reads. A pipeline wired to the wrong client or the wrong prefix
   * registers exactly the same routing keys and is silently alone.
   */
  describe("when suite-run processing is composed", () => {
    function compositionWith(
      input: {
        resolveClickHouseClient?: (tenantId: string) => Promise<unknown>;
        redis?: object;
        source?: Record<string, unknown>;
      } = {},
    ) {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...input.source }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: (input.resolveClickHouseClient ??
            (async () => ({
              insert: async () => undefined,
              query: async () => ({ json: async () => [] }),
            }))) as never,
          groupQueue: {
            redis: (input.redis ?? { get: async () => null, set: async () => "OK" }) as never,
          },
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
      });
    }

    /**
     * What `eventSourcing.register` hands back for this pipeline.
     *
     * The installer resolves its two deferred senders out of the returned
     * commands and refuses a registration missing either, so a bare
     * `{ commands: {} }` would fail these cases for a reason none of them is
     * about.
     */
    function registeredSuitePipeline() {
      return {
        commands: {
          recordSuiteRunItemStarted: { send: async () => undefined },
          completeSuiteRunItem: { send: async () => undefined },
        },
      } as never;
    }

    async function storeFoldedRunState(composition: WorkerProductionComposition): Promise<void> {
      const stores: FoldProjectionStore<Record<string, unknown>>[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        if (definition.metadata.name !== "suite_run_processing") return registeredSuitePipeline();
        for (const fold of definition.foldProjections.values()) {
          stores.push(
            (
              fold.definition as unknown as {
                store: FoldProjectionStore<Record<string, unknown>>;
              }
            ).store,
          );
        }
        return registeredSuitePipeline();
      });
      await composition.featureInstallers
        .find((candidate) => candidate.name === "suite")!
        .install();

      await stores[0]!.store(
        {
          SuiteRunId: "run_1",
          BatchRunId: "batch_1",
          ScenarioSetId: "suite:set_1",
          SuiteId: "suite_1",
          Status: "IN_PROGRESS",
          Total: 2,
          StartedCount: 1,
          CompletedCount: 0,
          FailedCount: 0,
          Progress: 1,
          PassRateBps: null,
          PassedCount: 0,
          GradedCount: 0,
          CreatedAt: 100,
          UpdatedAt: 200,
          LastEventOccurredAt: 190,
          StartedAt: 110,
          FinishedAt: null,
        },
        { aggregateId: "batch_1", tenantId: createTenantId("project_alpha") },
      );
    }

    /** @scenario "The worker mounts the pipeline rather than being handed one" */
    it("mounts suite without being handed a capability, and registers its pipeline", async () => {
      const composition = compositionWith();
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "suite",
      );
      expect(installer, "the composition mounted no suite feature").toBeDefined();
      const registered: string[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push(definition.metadata.name);
        return registeredSuitePipeline();
      });

      await installer!.install();

      expect(registered).toEqual(["suite_run_processing"]);
    });

    /** @scenario "Suite-run state is written through the client this graph resolved" */
    it("writes run state through the ClickHouse client this graph resolved", async () => {
      const insert = vi.fn(
        async (_request: { table: string; values: readonly unknown[] }) => undefined,
      );
      const resolveClickHouseClient = vi.fn(async () => ({
        insert,
        query: async () => ({ json: async () => [] }),
      }));

      await storeFoldedRunState(compositionWith({ resolveClickHouseClient }));

      expect(resolveClickHouseClient).toHaveBeenCalledWith("project_alpha");
      // 49 is the substrate's own `retention.defaultRetentionDays` above, not
      // a number configured a second time here. Two graphs stamping different
      // retentions on the same table expire each other's rows.
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        TenantId: "project_alpha",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the run-state fold under one keyspace" */
    it("caches through the Redis its own queue substrate runs on", async () => {
      const set = vi.fn(async (..._args: unknown[]) => "OK");
      const redis = { get: vi.fn(async () => null), set };

      await storeFoldedRunState(compositionWith({ redis }));

      // The connection this graph's queue already holds, under the prefix the
      // App's registry also caches by. A second connection would work and a
      // drifted prefix would not fail — each side would simply read a cache
      // the other never wrote, which is a stale read rather than an error.
      expect(set.mock.calls[0]![0]).toBe("fold:suite_runs:project_alpha:batch_1");
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("honours the fold cache TTL the environment names", async () => {
      const set = vi.fn(async (..._args: unknown[]) => "OK");
      const redis = { get: vi.fn(async () => null), set };

      await storeFoldedRunState(
        compositionWith({ redis, source: { LANGWATCH_FOLD_CACHE_TTL_SECONDS: "900" } }),
      );

      // The same variable the App reads. Two graphs caching one keyspace under
      // different TTLs expire each other's entries early, and a fold-cache miss
      // is treated as authoritative.
      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });
  });
});
