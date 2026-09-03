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
import { codingAgentSessionFoldState } from "@langwatch/coding-agent-server/testing";
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
import { EmailDeliveryAdapter } from "@langwatch/notification-server";
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
import { AbsentJoinRequestMail } from "../../features/identity/join-request-mail.adapter";
import { TraceWorkerFeatureInstaller } from "../../features/trace/trace-worker-feature.installer";
import { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";
import { createWorkerProcessDatabase } from "./support/worker-database.double";
import { createWorkerProcessRedis } from "./support/worker-redis.double";

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
  readonly claimAndBootstrap = vi.fn(async (_projectId: string) => undefined);
  readonly install = vi.fn(() => ({ claimAndBootstrap: this.claimAndBootstrap }));
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch = {
    recordTopics: vi.fn(async () => undefined),
    requestClustering: vi.fn(async () => undefined),
  };
}

class EventingTopicCapability implements TopicWorkerCapability {
  readonly claimAndBootstrap = vi.fn(async (_projectId: string) => undefined);
  readonly install = vi.fn(() => ({ claimAndBootstrap: this.claimAndBootstrap }));
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
    commands: { recordSpan: async () => undefined },
  }));

  constructor(private readonly traceAssignments: TraceTopicAssignmentPort) {}
}

function createProcessPersistenceDatabase() {
  return createWorkerProcessDatabase();
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
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase() as never,
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

    function compositionFor(source: Record<string, unknown>): WorkerProductionComposition {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...source }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: async () => ({
            insert: async () => undefined,
            query: async () => ({ json: async () => [] }),
          }),
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase() as never,
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
      expect(
        globalRoutingKeys(compositionFor({ IS_SAAS: "true", STRIPE_SECRET_KEY: "sk_test_worker" })),
      ).toEqual(expectedGlobalRoutingKeys());
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
        redis: createWorkerProcessRedis() as never,
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
     * billing reporting pipeline, which this same composition now registers
     * unconditionally — so the pairing is structural rather than checked. What
     * a SaaS graph can still be missing is the credential the reports are SENT
     * with, and it is refused for the same reason: a process that counted
     * every billable event correctly and reported none of them would leave
     * revenue present in ClickHouse, absent from Stripe, and visible nowhere
     * else. This is the refusal `AppStripeRuntime.create` already makes, so
     * the App and the worker fail the same misconfiguration identically.
     */
    /** @scenario "A SaaS worker refuses to compose without the credential its reports are sent with" */
    it("refuses to compose a SaaS graph with no Stripe secret to report through", () => {
      expect(() => compositionFor({ IS_SAAS: "true" })).toThrow(/Stripe secret key is required/);
    });

    /**
     * The other direction, and the reason the pipeline is NOT gated on the
     * deployment leaf the meter is gated on: the legacy registry registers the
     * roll-up on every install, and the two graphs share one
     * `event-sourcing/jobs` queue. A consumer that skipped it on a self-hosted
     * install would reject the App's own `billing_reporting` jobs for
     * redelivery forever while every health signal stayed green.
     */
    /** @scenario "The monthly roll-up is registered on every install" */
    it("mounts the reporting pipeline on a self-hosted install too, with no sender", () => {
      const features = compositionFor({}).featureInstallers.map((installer) => installer.name);

      expect(features).toContain("billing-reporting");
      expect(globalRoutingKeys(compositionFor({}))).toEqual([]);
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
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(topicDatabase) as never,
        ...(Object.keys(database).length > 0
          ? { database: createWorkerProcessDatabase(database) as never }
          : {}),
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
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(input.database ?? {}) as never,
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
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(topicDatabase) as never,
        ...(Object.keys(database).length > 0
          ? { database: createWorkerProcessDatabase(database) as never }
          : {}),
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
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase() as never,
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

    /** @scenario "The ADR-056 edge is mounted rather than declared missing" */
    it("mounts the coding-agent dispatch subscribers, because the pipeline is always there", async () => {
      const { composition } = compositionWith();

      const metric = definitionsFrom(composition, "metric");
      await metric.installer.install();
      const log = definitionsFrom(composition, "log");
      await log.installer.install();

      // Unconditional since the Coding Agent pipeline became this graph's own
      // to compose. There is no longer a graph in which the two source
      // pipelines mount and the session pipeline they contribute into does
      // not, so there is no absence left to report.
      expect(metric.registered[0]!.subscribers).toEqual(["codingAgentMetricFactsDispatch"]);
      expect(log.registered[0]!.subscribers).toEqual(["codingAgentLogFactsDispatch"]);
    });

    /** @scenario "The ADR-056 edge is mounted rather than declared missing" */
    it("says nothing at boot about a missing Coding Agent pipeline", () => {
      const warn = vi.fn();

      const { composition } = compositionWith({
        observability: { logger: { info: vi.fn(), warn } },
      });

      expect(warn).not.toHaveBeenCalledWith(
        { reason: "no-coding-agent-pipeline" },
        expect.anything(),
      );
      expect(composition.featureInstallers.map((installer) => installer.name)).toEqual(
        expect.arrayContaining(["metric", "log", "coding-agent"]),
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
  describe("when the identity ledgers are composed", () => {
    function identityDatabase() {
      const calls: string[] = [];
      const record =
        <Result>(name: string, result: Result) =>
        async (..._args: unknown[]): Promise<Result> => {
          calls.push(name);
          return result;
        };
      const identifierUpsert = vi.fn(record("identifier.upsert", undefined));
      const cursorUpsert = vi.fn(record("cursor.upsert", undefined));
      const reservationDeleteMany = vi.fn(record("reservation.deleteMany", { count: 0 }));
      const scimUpsert = vi.fn(record("scimSyncState.upsert", undefined));
      const database = {
        identifier: {
          upsert: identifierUpsert,
          findMany: vi.fn(record("identifier.findMany", [] as unknown[])),
          findFirst: vi.fn(record("identifier.findFirst", null)),
        },
        identityProjectionCursor: {
          upsert: cursorUpsert,
          findUnique: vi.fn(record("cursor.findUnique", null)),
        },
        identifierReservation: { deleteMany: reservationDeleteMany },
        account: {
          upsert: vi.fn(record("account.upsert", undefined)),
          deleteMany: vi.fn(record("account.deleteMany", { count: 0 })),
        },
        user: {
          findUnique: vi.fn(record("user.findUnique", { id: "user_sam" })),
          findFirst: vi.fn(record("user.findFirst", null)),
          updateMany: vi.fn(record("user.updateMany", { count: 0 })),
        },
        mfaEnrollment: {
          findUnique: vi.fn(record("mfa.findUnique", null)),
          upsert: vi.fn(record("mfa.upsert", undefined)),
        },
        scimSyncState: {
          upsert: scimUpsert,
          findUnique: vi.fn(record("scimSyncState.findUnique", null)),
          findFirst: vi.fn(record("scimSyncState.findFirst", null)),
        },
        $queryRaw: vi.fn(record("$queryRaw", [] as unknown[])),
      };
      return { database, calls, identifierUpsert, cursorUpsert, reservationDeleteMany, scimUpsert };
    }

    function compositionWith(
      input: { database?: object; identity?: object } = {},
    ): WorkerProductionComposition {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: async () => ({
            insert: async () => undefined,
            query: async () => ({ json: async () => [] }),
          }),
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(input.database ?? {}) as never,
        ...(input.identity ? { identity: input.identity as never } : {}),
      });
    }

    async function registeredThrough(
      composition: WorkerProductionComposition,
      feature: string,
    ): Promise<{ names: string[]; definitions: Record<string, unknown>[] }> {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === feature,
      );
      expect(installer, `the composition mounted no ${feature} feature`).toBeDefined();
      const names: string[] = [];
      const definitions: Record<string, unknown>[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        names.push(definition.metadata.name);
        definitions.push(definition as unknown as Record<string, unknown>);
        return {} as never;
      });
      await installer!.install();
      return { names, definitions };
    }

    /**
     * The two ledgers whose whole dependency set is Postgres. The other two
     * are not: the connection ledger's teardown revokes directory tokens
     * through the SCIM service, and the join ledger's lifecycle sends mail.
     */
    /** @scenario "The worker mounts the identity and directory-sync ledgers itself" */
    it("mounts both without being handed a capability", async () => {
      const composition = compositionWith();

      expect(await registeredThrough(composition, "identity")).toMatchObject({
        names: ["identity"],
      });
      expect(await registeredThrough(composition, "scim-sync")).toMatchObject({
        names: ["scim-sync"],
      });
    });

    /**
     * ALL THREE, from nothing but this process's own client.
     *
     * The connection ledger used to arrive as an option, because its teardown
     * wake dispatched through a service bound to the application singleton and
     * then revoked directory tokens through the SCIM capability. Both are seams
     * now, so there is no reading in which this graph has the other two ledgers
     * and not this one — and there must not be, since this is the only graph
     * that can advance a requested teardown to TORN_DOWN.
     *
     * `join-request` is absent here because this composition names no
     * `BASE_HOST`, so it composed no mail capability — which is the whole
     * subject of the block below.
     */
    /** @scenario "The worker mounts the identity and directory-sync ledgers itself" */
    it("mounts all three identity ledgers without being handed a capability", () => {
      const mounted = compositionWith().featureInstallers.map((installer) => installer.name);
      expect(
        mounted.filter((name) => ["identity", "sso-connection", "scim-sync"].includes(name)),
      ).toEqual(["identity", "sso-connection", "scim-sync"]);
    });

    /** @scenario "The worker builds the identity ledger from its own client" */
    it("folds identifier heads onto the one Prisma client this process opened", async () => {
      const recording = identityDatabase();
      const composition = compositionWith({ database: recording.database });
      const { definitions } = await registeredThrough(composition, "identity");
      const store = (
        definitions[0] as unknown as {
          stateProjections: Map<string, { store: { store(...args: never[]): Promise<void> } }>;
        }
      ).stateProjections.get("identityState")!.store;

      await store.store(
        ...([
          {
            state: {
              userId: "user_sam",
              identifiers: {
                idf_1: {
                  identifierId: "idf_1",
                  userId: "user_sam",
                  provider: "email",
                  value: "sam@acme.com",
                  domain: "acme.com",
                  identifierHash: null,
                  accountId: null,
                  providerId: null,
                  issuer: null,
                  providerAccountId: null,
                  connectionId: null,
                  state: "VERIFIED",
                  verifiedAtMs: 1_700_000_000_000,
                  attachedAtMs: 1_600_000_000_000,
                  detachedAtMs: null,
                },
              },
              CreatedAt: 1_600_000_000_000,
              UpdatedAt: 1_700_000_000_000,
              LastEventOccurredAt: 1_700_000_000_000,
            },
            cursor: { acceptedAt: 1_700_000_000_500, eventId: "evt_1" },
            occurredAt: 1_700_000_000_000,
            createdAt: 1_600_000_000_000,
            updatedAt: 1_700_000_000_000,
            version: "1",
          },
          { aggregateId: "user_sam", tenantId: createTenantId("user_sam") },
        ] as never[]),
      );

      expect(recording.identifierUpsert).toHaveBeenCalledTimes(1);
      // The address lock the guards claim through, released by the fold.
      expect(recording.reservationDeleteMany).toHaveBeenCalledWith({
        where: { userId: "user_sam", identifierId: { notIn: ["idf_1"] } },
      });
      // The cursor is the commit marker, so it lands last.
      expect(recording.calls.at(-1)).toBe("cursor.upsert");
    });

    /** @scenario "The worker builds the directory-sync ledger from its own client" */
    it("folds directory-sync state onto that same client", async () => {
      const recording = identityDatabase();
      const composition = compositionWith({ database: recording.database });
      const { definitions } = await registeredThrough(composition, "scim-sync");
      const store = (
        definitions[0] as unknown as {
          stateProjections: Map<string, { store: { store(...args: never[]): Promise<void> } }>;
        }
      ).stateProjections.get("scimSyncState")!.store;

      await store.store(
        ...([
          {
            state: {
              scimSyncId: "scimsync_1",
              connectionId: "ssoconn_1",
              organizationId: "organization_acme",
              state: "ACTIVE",
              lastPushedAtMs: null,
              lastFailure: null,
              deadLetters: [],
              revokedCause: null,
              createdAtMs: 1_600_000_000_000,
              updatedAtMs: 1_700_000_000_000,
              CreatedAt: 1_600_000_000_000,
              UpdatedAt: 1_700_000_000_000,
              LastEventOccurredAt: 1_700_000_000_000,
            },
            cursor: { acceptedAt: 1_700_000_000_500, eventId: "evt_1" },
            occurredAt: 1_700_000_000_000,
            createdAt: 1_600_000_000_000,
            updatedAt: 1_700_000_000_000,
            version: "1",
          },
          { aggregateId: "scimsync_1", tenantId: createTenantId("organization_acme") },
        ] as never[]),
      );

      expect(recording.scimUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the monthly billing roll-up is composed", () => {
    function reportingSubstrate() {
      const organizationFindFirst = vi.fn(async () => ({
        id: "organization_acme",
        stripeCustomerId: "cus_1",
        subscriptions: [{ id: "sub_1" }],
      }));
      const checkpointFindUnique = vi.fn(async () => null);
      const redisGet = vi.fn(async () => null);
      const redisSetex = vi.fn(async () => "OK");
      const resolveClickHouseClient = vi.fn(async () => ({
        insert: async () => undefined,
        query: async () => ({ json: async () => [{ total: "0" }] }),
      }));
      const database = {
        organization: { findFirst: organizationFindFirst },
        billingMeterCheckpoint: {
          findUnique: checkpointFindUnique,
          upsert: vi.fn(async () => undefined),
        },
      };
      return {
        database,
        organizationFindFirst,
        checkpointFindUnique,
        redisGet,
        redisSetex,
        resolveClickHouseClient,
        redis: createWorkerProcessRedis({ get: redisGet, setex: redisSetex }),
      };
    }

    function compositionWith(
      substrate: ReturnType<typeof reportingSubstrate>,
    ): WorkerProductionComposition {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: substrate.resolveClickHouseClient as never,
          groupQueue: { redis: substrate.redis as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(substrate.database) as never,
      });
    }

    async function reportOneMonth(substrate: ReturnType<typeof reportingSubstrate>): Promise<void> {
      const composition = compositionWith(substrate);
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "billing-reporting",
      );
      expect(installer, "the composition mounted no billing-reporting feature").toBeDefined();
      const definitions: Record<string, unknown>[] = [];
      vi.spyOn(composition.eventing.eventSourcing, "register").mockImplementation((definition) => {
        definitions.push(definition as unknown as Record<string, unknown>);
        return { commands: { reportUsageForMonth: { send: async () => undefined } } } as never;
      });
      await installer!.install();

      const command = (
        definitions[0] as unknown as {
          commands: {
            name: string;
            handlerInstance?: { handle(command: unknown): Promise<void> };
          }[];
        }
      ).commands.find((candidate) => candidate.name === "reportUsageForMonth");
      expect(command?.handlerInstance, "the roll-up registered no handler").toBeDefined();

      await command!.handlerInstance!.handle({
        data: {
          organizationId: "organization_acme",
          billingMonth: "2026-08",
          tenantId: "project_alpha",
          occurredAt: 1_700_000_000_000,
        },
      });
    }

    /**
     * The billable-events table is keyed by ORGANIZATION, and the tenant-keyed
     * resolver this process already holds answers it because the routing
     * directory treats an organization id as a tenant of itself. Asking for the
     * project instead would still return a client and still return a number —
     * off the shared instance, for a customer whose data is on their own
     * cluster — and a wrong total is reported to Stripe rather than noticed.
     */
    /** @scenario "The worker reads the month's total by organization, not by tenant" */
    it("resolves the roll-up's ClickHouse client for the organization, not the tenant", async () => {
      const substrate = reportingSubstrate();

      await reportOneMonth(substrate);

      expect(substrate.resolveClickHouseClient).toHaveBeenCalledWith("organization_acme");
      expect(substrate.resolveClickHouseClient).not.toHaveBeenCalledWith("project_alpha");
    });

    /**
     * The organization read and the checkpoint both ride the one Prisma client
     * this process opened, and the read-through cache rides the queue's one
     * Redis under the keyspace the App's own `TtlCache` writes.
     */
    /** @scenario "The worker builds the monthly roll-up from its own client" */
    it("reads the organization, the cache and the checkpoint off this process's own substrates", async () => {
      const substrate = reportingSubstrate();

      await reportOneMonth(substrate);

      expect(substrate.redisGet).toHaveBeenCalledWith("ttlcache:billing:orgData:organization_acme");
      expect(substrate.organizationFindFirst).toHaveBeenCalledTimes(1);
      expect(substrate.redisSetex).toHaveBeenCalledWith(
        "ttlcache:billing:orgData:organization_acme",
        60,
        expect.any(String),
      );
      expect(substrate.checkpointFindUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the AuthZ grants ledger is composed", () => {
    function grantsDatabase() {
      const executeRaw = vi.fn(async () => 1);
      const roleBindingUpsert = vi.fn(async () => undefined);
      const auditCreateMany = vi.fn(async () => ({ count: 1 }));
      const delegate = () => ({
        findUnique: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async () => undefined),
      });
      const database = {
        grant: delegate(),
        role: delegate(),
        roleBinding: { ...delegate(), upsert: roleBindingUpsert },
        customRole: delegate(),
        shareLink: delegate(),
        auditLog: { createMany: auditCreateMany },
        $transaction: vi.fn(async (writes: Promise<unknown>[]) => Promise.all(writes)),
        $executeRaw: executeRaw,
      };
      return { database, executeRaw, roleBindingUpsert, auditCreateMany };
    }

    function compositionWith(database: object = {}): WorkerProductionComposition {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        eventing: {
          database: createProcessPersistenceDatabase(),
          resolveClickHouseClient: async () => ({
            insert: async () => undefined,
            query: async () => ({ json: async () => [] }),
          }),
          groupQueue: { redis: createWorkerProcessRedis() as never },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase(database) as never,
      });
    }

    async function registeredGrantsPipeline(
      composition: WorkerProductionComposition,
    ): Promise<{ names: string[]; definition: Record<string, unknown> }> {
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "authz",
      );
      expect(installer, "the composition mounted no authz feature").toBeDefined();
      const names: string[] = [];
      const definitions: Record<string, unknown>[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        names.push(definition.metadata.name);
        definitions.push(definition as unknown as Record<string, unknown>);
        return {} as never;
      });
      await installer!.install();
      return { names, definition: definitions[0]! };
    }

    /**
     * The consumer half of the ledger takes exactly two Postgres bindings, so
     * this process builds it rather than receiving a definition the App
     * assembled. Its producer half stays with the application: `connect` hands
     * a WRITER the senders a registration produced, and this process writes no
     * grants.
     */
    /** @scenario "The worker mounts the grants ledger itself" */
    it("mounts the grants ledger without being handed a capability", async () => {
      const composition = compositionWith(grantsDatabase().database);

      expect(await registeredGrantsPipeline(composition)).toMatchObject({
        names: ["authz_grant"],
      });
    });

    /**
     * One grant event expands onto BOTH heads through one client: the
     * authoritative `Grant` row behind its own `occurredAt` guard, and the
     * legacy `RoleBinding` the legacy resolver and the settings screens still
     * read. A graph wired to a second client would register identical routing
     * keys and write half the expansion somewhere else.
     */
    /** @scenario "The worker builds the grants ledger from its own client" */
    it("expands a grant onto the one Prisma client this process opened", async () => {
      const recording = grantsDatabase();
      const composition = compositionWith(recording.database);
      const { definition } = await registeredGrantsPipeline(composition);
      const projection = (
        definition as unknown as {
          mapProjections: Map<
            string,
            {
              definition: {
                map(event: unknown): unknown;
                store: { append(write: unknown, context: unknown): Promise<void> };
              };
            }
          >;
        }
      ).mapProjections.get("authzGrantsWrite")!.definition;

      await projection.store.append(
        projection.map({
          id: "event_1",
          aggregateId: "grant_1",
          aggregateType: "authz_grant",
          tenantId: createTenantId("organization_acme"),
          createdAt: 1_700_000_000_000,
          occurredAt: 1_700_000_000_000,
          type: "lw.authz.grant.attached",
          version: "1",
          data: {
            grantId: "grant_1",
            principal: { type: "user", id: "user_sam" },
            roleKey: "member",
            scope: { type: "TEAM", id: "team_1" },
            source: "grants-service",
            actor: { type: "user", id: "user_admin" },
          },
        }),
        {} as never,
      );

      expect(recording.executeRaw).toHaveBeenCalledTimes(1);
      expect(recording.roleBindingUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "organization_acme", id: "grant_1" },
        }),
      );
    });
  });

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
            redis: (input.redis ?? createWorkerProcessRedis()) as never,
          },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase() as never,
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
      const redis = createWorkerProcessRedis({ get: vi.fn(async () => null), set });

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
      const redis = createWorkerProcessRedis({ get: vi.fn(async () => null), set });

      await storeFoldedRunState(
        compositionWith({ redis, source: { LANGWATCH_FOLD_CACHE_TTL_SECONDS: "900" } }),
      );

      // The same variable the App reads. Two graphs caching one keyspace under
      // different TTLs expire each other's entries early, and a fold-cache miss
      // is treated as authoritative.
      expect(set.mock.calls[0]!.slice(2)).toEqual(["EX", 900]);
    });
  });

  /**
   * The ADR-056 session pipeline, composed here rather than handed over built.
   *
   * It was the App's to build for one reason that turned out to be two
   * misreadings: pricing a model call looked like it needed the provider
   * stack, and stamping a project looked like it needed the project service.
   * Neither is true — the first is a pure function over the platform catalog,
   * the second one throttled UPDATE — so what these cases hold is that this
   * graph composes the pipeline from its own ClickHouse client, its own Redis
   * and its own Prisma client, and that the GitHub demand path the mapping
   * subscriber needs is composed alongside it.
   */
  describe("when coding-agent session processing is composed", () => {
    function compositionWith(
      input: {
        resolveClickHouseClient?: (tenantId: string) => Promise<unknown>;
        redis?: object;
        database?: object;
        source?: Record<string, unknown>;
      } = {},
    ) {
      return WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test", ...input.source }),
        eventing: {
          database: (input.database ?? createProcessPersistenceDatabase()) as never,
          resolveClickHouseClient: (input.resolveClickHouseClient ??
            (async () => ({
              insert: async () => undefined,
              query: async () => ({ json: async () => [] }),
            }))) as never,
          groupQueue: {
            redis: (input.redis ?? createWorkerProcessRedis()) as never,
          },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: (input.database ?? createProcessPersistenceDatabase()) as never,
      });
    }

    /**
     * What `eventSourcing.register` hands back for this pipeline. The installer
     * resolves three deferred contribution senders out of the returned commands
     * and refuses a registration missing any, so a bare `{ commands: {} }`
     * would fail these cases for a reason none of them is about.
     */
    function registeredCodingAgentPipeline() {
      return {
        commands: {
          contributeSpanFacts: { send: async () => undefined },
          contributeMetricFacts: { send: async () => undefined },
          contributeLogFacts: { send: async () => undefined },
        },
      } as never;
    }

    async function storeFoldedSession(composition: WorkerProductionComposition): Promise<void> {
      const stores: FoldProjectionStore<Record<string, unknown>>[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        if (definition.metadata.name !== "coding_agent_processing") {
          return registeredCodingAgentPipeline();
        }
        for (const fold of definition.foldProjections.values()) {
          stores.push(
            (
              fold.definition as unknown as {
                store: FoldProjectionStore<Record<string, unknown>>;
              }
            ).store,
          );
        }
        return registeredCodingAgentPipeline();
      });
      await composition.featureInstallers
        .find((candidate) => candidate.name === "coding-agent")!
        .install();

      await stores[0]!.store(codingAgentSessionFoldState() as never, {
        aggregateId: "session_1",
        tenantId: createTenantId("project_alpha"),
      });
    }

    /** @scenario "The worker mounts the pipeline rather than being handed one" */
    it("mounts coding-agent without being handed a capability, and registers its pipeline", async () => {
      const composition = compositionWith();
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "coding-agent",
      );
      expect(installer, "the composition mounted no coding-agent feature").toBeDefined();
      const registered: string[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push(definition.metadata.name);
        return registeredCodingAgentPipeline();
      });

      await installer!.install();

      expect(registered).toEqual(["coding_agent_processing"]);
    });

    /** @scenario "The worker mounts the pipeline rather than being handed one" */
    it("wires the GitHub demand path into the definition it registers", async () => {
      const composition = compositionWith();
      const subscribers: string[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        if (definition.metadata.name === "coding_agent_processing") {
          subscribers.push(...definition.foldSubscribers.keys());
        }
        return registeredCodingAgentPipeline();
      });

      await composition.featureInstallers
        .find((candidate) => candidate.name === "coding-agent")!
        .install();

      // `reactor:pullRequestMapping` exists only because a demand path was
      // passed in. Composing one and forgetting to hand it over registers one
      // routing key fewer than the producer stages jobs against, and the queue
      // rejects an unroutable job for redelivery rather than dropping it.
      expect(subscribers).toEqual(["pullRequestMapping"]);
    });

    /** @scenario "The worker mounts the pipeline rather than being handed one" */
    it("mounts it before metric, log and trace, whose subscribers dispatch into it", () => {
      const names = compositionWith().featureInstallers.map((installer) => installer.name);
      const codingAgent = names.indexOf("coding-agent");

      // Not a preference: the dispatch subscribers Metric, Log and Trace mount
      // close over this pipeline's contribution senders, and those senders are
      // proxies that refuse until this registration resolves them.
      for (const later of ["metric", "log", "trace"]) {
        expect(codingAgent, `coding-agent must precede ${later}`).toBeLessThan(
          names.indexOf(later),
        );
      }
    });

    /** @scenario "Session rows are written through the client this graph resolved" */
    it("writes session rows through the ClickHouse client this graph resolved", async () => {
      const insert = vi.fn(
        async (_request: { table: string; values: readonly unknown[] }) => undefined,
      );
      const resolveClickHouseClient = vi.fn(async () => ({
        insert,
        query: async () => ({ json: async () => [] }),
      }));

      await storeFoldedSession(compositionWith({ resolveClickHouseClient }));

      expect(resolveClickHouseClient).toHaveBeenCalledWith("project_alpha");
      // 49 is the substrate's own `retention.defaultRetentionDays` above, not
      // a number configured a second time here. Two graphs stamping different
      // retentions on the same table expire each other's rows.
      expect(insert.mock.calls[0]![0].values[0]).toMatchObject({
        TenantId: "project_alpha",
        SessionId: "session_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the session fold under one keyspace" */
    it("caches through the Redis its own queue substrate runs on", async () => {
      const set = vi.fn(async (..._args: unknown[]) => "OK");
      const redis = createWorkerProcessRedis({ get: vi.fn(async () => null), set });

      await storeFoldedSession(compositionWith({ redis }));

      expect(set.mock.calls[0]![0]).toBe("fold:coding_agent_sessions:project_alpha:session_1");
    });

    /** @scenario "Storing a session stamps its project's activity" */
    it("stamps the project through the one Prisma client this process opened", async () => {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const database = { ...createProcessPersistenceDatabase(), project: { updateMany } };

      await storeFoldedSession(compositionWith({ database }));

      // The stamp is fire-and-forget behind the commit; what this holds is
      // that it lands on this process's own client rather than on a project
      // service this graph does not have.
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lastCodingAgentSessionAt: expect.any(Date) } }),
      );
    });
  });

  describe("when experiment-run processing is composed", () => {
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
            redis: (input.redis ?? createWorkerProcessRedis()) as never,
          },
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        database: createWorkerProcessDatabase() as never,
      });
    }

    /**
     * What `eventSourcing.register` hands back for this pipeline.
     *
     * The installer resolves Trace's `computeExperimentRunMetrics` proxy out of
     * the returned commands and refuses a registration missing it, so a bare
     * `{ commands: {} }` would fail these cases for a reason neither is about.
     */
    function registeredExperimentPipeline() {
      return {
        commands: { computeExperimentRunMetrics: { send: async () => undefined } },
      } as never;
    }

    async function storeFoldedRunState(composition: WorkerProductionComposition): Promise<void> {
      const stores: FoldProjectionStore<Record<string, unknown>>[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        if (definition.metadata.name !== "experiment_run_processing") {
          return registeredExperimentPipeline();
        }
        for (const fold of definition.foldProjections.values()) {
          stores.push(
            (
              fold.definition as unknown as {
                store: FoldProjectionStore<Record<string, unknown>>;
              }
            ).store,
          );
        }
        return registeredExperimentPipeline();
      });
      await composition.featureInstallers
        .find((candidate) => candidate.name === "experiment")!
        .install();

      await stores[0]!.store(
        {
          RunId: "run_1",
          ExperimentId: "experiment_1",
          WorkflowVersionId: null,
          Total: 2,
          Progress: 1,
          CompletedCount: 1,
          FailedCount: 0,
          TotalCost: 0.25,
          TotalDurationMs: 1200,
          AvgScoreBps: 7500,
          PassRateBps: 5000,
          Targets: "[]",
          CreatedAt: 100,
          UpdatedAt: 200,
          LastEventOccurredAt: 190,
          StartedAt: 110,
          FinishedAt: null,
          StoppedAt: null,
          TotalScoreSum: 0.75,
          ScoreCount: 1,
          PassedCount: 1,
          GradedCount: 2,
          TraceMetrics: {},
        },
        {
          aggregateId: "experiment_1:run_1",
          tenantId: createTenantId("project_alpha"),
        },
      );
    }

    /** @scenario "The worker mounts the pipeline rather than being handed one" */
    it("mounts experiment without being handed a capability, and registers its pipeline", async () => {
      const composition = compositionWith();
      const installer = composition.featureInstallers.find(
        (candidate) => candidate.name === "experiment",
      );
      expect(installer, "the composition mounted no experiment feature").toBeDefined();
      const registered: string[] = [];
      const eventSourcing = composition.eventing.eventSourcing;
      vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
        registered.push(definition.metadata.name);
        return registeredExperimentPipeline();
      });

      await installer!.install();

      expect(registered).toEqual(["experiment_run_processing"]);
    });

    /** @scenario "Run state is written through the client this graph resolved" */
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
        RunId: "run_1",
        _retention_days: 49,
      });
    });

    /** @scenario "Both graphs cache the run-state fold under one keyspace" */
    it("caches through the Redis its own queue substrate runs on", async () => {
      const set = vi.fn(async (..._args: unknown[]) => "OK");
      const redis = createWorkerProcessRedis({ get: vi.fn(async () => null), set });

      await storeFoldedRunState(compositionWith({ redis }));

      // The connection this graph's queue already holds, under the prefix the
      // App's registry also caches by. A second connection would work and a
      // drifted prefix would not fail — each side would simply read a cache
      // the other never wrote, which is a stale read rather than an error.
      expect(set.mock.calls[0]![0]).toBe("fold:experiment_runs:project_alpha:experiment_1:run_1");
    });

    /** @scenario "Producer and consumer honour one fold cache TTL" */
    it("honours the fold cache TTL the environment names", async () => {
      const set = vi.fn(async (..._args: unknown[]) => "OK");
      const redis = createWorkerProcessRedis({ get: vi.fn(async () => null), set });

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

/**
 * The join-request ledger, and the mail capability that finally lets this
 * process build it.
 *
 * What kept this graph in the application was never persistence: the
 * `JoinRequest` head is Postgres like the other three ledgers'. It was the
 * lifecycle port — the day-7 reminder and the lapse notice are outbound mail,
 * and no process but the App had a gateway to send it through.
 *
 * The failure this block exists to catch is the quiet one. `join-requests`
 * names five commands, a state projection and the lifecycle subscriber in the
 * checked-in job registry, and the queue rejects an unroutable job for
 * redelivery rather than dropping it — so a consumer that mounted everything
 * else would stall exactly those seven forever with the pods up, the liveness
 * probe answering and the queue depth simply growing.
 */
describe("given a worker that composes the join-request ledger", () => {
  /** The routing keys the checked-in job registry says this pipeline carries.
   *  Read rather than restated: a literal here would only ever assert this
   *  file against itself. */
  function expectedJoinRequestRoutingKeys(): string[] {
    const registry = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../../features/job-registry.json"),
        "utf8",
      ),
    ) as { pipelines: { name: string; jobs: string[] }[] };
    const entry = registry.pipelines.find((pipeline) => pipeline.name === "join-requests");
    expect(entry, "the job registry names no join-requests pipeline").toBeDefined();
    return entry!.jobs.map((job) => `${entry!.name}:${job}`).sort();
  }

  function compositionFor(
    input: {
      source?: Record<string, unknown>;
      resources?: ResourceScope;
      consumers?: boolean;
    } = {},
  ): WorkerProductionComposition {
    return WorkerProductionComposition.create({
      config: resolveWorkerConfig({ NODE_ENV: "test", ...input.source }),
      eventing: {
        database: createProcessPersistenceDatabase(),
        resolveClickHouseClient: async () => ({
          insert: async () => undefined,
          query: async () => ({ json: async () => [] }),
        }),
        groupQueue: { redis: createWorkerProcessRedis() as never },
        retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
        ...(input.consumers ? { consumers: { enabled: true as const } } : {}),
      },
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      database: createWorkerProcessDatabase() as never,
      ...(input.resources ? { resources: input.resources } : {}),
    });
  }

  const mailSource = {
    BASE_HOST: "https://langwatch.acme.example",
    EMAIL_PROVIDER: "smtp",
    SMTP_URL: "smtp://relay.acme.example:587",
  };

  async function routingKeysFor(composition: WorkerProductionComposition): Promise<string[]> {
    const installer = composition.featureInstallers.find(
      (candidate) => candidate.name === "join-request",
    );
    expect(installer, "the composition mounted no join-request feature").toBeDefined();
    await installer!.install();
    return [...composition.eventing.eventSourcing.globalJobRegistry.keys()]
      .filter((key) => key.startsWith("join-requests:"))
      .sort();
  }

  describe("when the deployment named a host and the graph owns a resource scope", () => {
    /** @scenario "A worker with a mail gateway mounts the join-request ledger itself" */
    it("mounts it and routes exactly the keys the job registry names", async () => {
      const composition = compositionFor({
        source: mailSource,
        resources: new ResourceScope(),
      });

      expect(await routingKeysFor(composition)).toEqual(expectedJoinRequestRoutingKeys());
    });

    /** @scenario "A worker with a mail gateway mounts the join-request ledger itself" */
    it("no longer takes the pipeline from the application", () => {
      const composition = compositionFor({
        source: mailSource,
        resources: new ResourceScope(),
      });

      // The option that used to carry it is gone entirely, and so is the one
      // that used to carry the connection ledger beside it. A graph that still
      // received either definition would register the application's stores
      // rather than its own, and register the identical routing keys while
      // doing it.
      const mounted = composition.featureInstallers.map((installer) => installer.name);
      expect(mounted).toContain("join-request");
      expect(mounted).toContain("sso-connection");
    });

    /** @scenario "The mail capability is closed with the graph that composed it" */
    it("hands the transport to the scope that closes it", async () => {
      // A gateway holds a transport — an SMTP connection pool, an SES client,
      // a proxy dispatcher. A graph that composed one it could not close would
      // leak it for the life of the process.
      const close = vi.spyOn(EmailDeliveryAdapter.prototype, "close").mockResolvedValue(undefined);
      try {
        const resources = new ResourceScope();
        compositionFor({ source: mailSource, resources });
        expect(close).not.toHaveBeenCalled();

        await resources.close();

        expect(close).toHaveBeenCalledOnce();
      } finally {
        close.mockRestore();
      }
    });
  });

  describe("when the deployment named no host", () => {
    /**
     * The pipeline still mounts, and that is the point. Its routing keys are in
     * the byte-frozen registry and its expiry is a fold this graph performs, so
     * a request lapses on time whether or not anybody can be told. What is
     * absent is the mail, by name.
     */
    /** @scenario "A producer-only worker without mail still routes every key" */
    it("still mounts the ledger and routes every key the registry names", async () => {
      const composition = compositionFor({ resources: new ResourceScope() });

      expect(await routingKeysFor(composition)).toEqual(expectedJoinRequestRoutingKeys());
    });

    /** @scenario "A producer-only worker without mail still routes every key" */
    it("refuses a send by name rather than reporting one that never happened", async () => {
      await expect(
        AbsentJoinRequestMail.create().sendStillWaiting({
          adminEmail: "admin@acme.example",
          organizationName: "Acme",
          requesterName: "Ada Lovelace",
        }),
      ).rejects.toThrow(/composed no outbound mail gateway/);
      await expect(
        AbsentJoinRequestMail.create().sendExpired({
          requesterEmail: "ada@acme.example",
          organizationName: "Acme",
        }),
      ).rejects.toThrow(/composed no outbound mail gateway/);
    });

    /** @scenario "A consuming worker without mail refuses to compose" */
    it("refuses to compose a graph that would claim the shared queue", () => {
      expect(() => compositionFor({ resources: new ResourceScope(), consumers: true })).toThrow(
        /will not claim event-sourcing\/jobs without outbound mail/,
      );
    });

    /**
     * The one graph the refusal deliberately lets through: a composition with
     * no resource scope owns nothing closable, so it could not hold a mail
     * transport even where the deployment is fully configured. Every root that
     * runs as a process supplies a scope, so this shape is a partially-composed
     * graph rather than a misconfigured deployment.
     */
    /** @scenario "A consuming worker without mail refuses to compose" */
    it("lets a scope-less composition through rather than refusing a fixture", () => {
      expect(() => compositionFor({ consumers: true })).not.toThrow();
    });

    /** @scenario "A consuming worker without mail refuses to compose" */
    it("composes the same graph once the host is named", () => {
      expect(() =>
        compositionFor({
          source: mailSource,
          resources: new ResourceScope(),
          consumers: true,
        }),
      ).not.toThrow();
    });
  });
});

/**
 * THE TENANCY GRAPH IS THE PRECONDITION THE MODEL GATEWAY REFUSED WITHOUT, and
 * the wiring that carries it is one option on this root — so this is the level
 * the claim "production stops logging no-tenancy" has to be made at. The
 * gateway's own composition is proven in
 * `worker-tenancy.composition.unit.test.ts`; what is under test here is that
 * the root hands the graph over at all.
 */
describe("the model gateway on the production graph", () => {
  function compositionWithConnection(input: {
    connection?: object;
    observability?: { logger: { info: unknown; warn: unknown } };
  }) {
    return WorkerProductionComposition.create({
      config: resolveWorkerConfig({
        NODE_ENV: "test",
        // A real 32-byte hex key: the stored-secret cipher refuses anything
        // else, and this graph composes it for the gateway and three other
        // verticals.
        CREDENTIALS_SECRET: "1".repeat(64),
      }),
      eventing: {
        database: createProcessPersistenceDatabase(),
        resolveClickHouseClient: async () => ({
          insert: async () => undefined,
          query: async () => ({ json: async () => [] }),
        }),
        groupQueue: { redis: createWorkerProcessRedis() as never },
        retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
      },
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      database: createWorkerProcessDatabase() as never,
      ...(input.connection ? { connection: { client: input.connection } as never } : {}),
      ...(input.observability ? { observability: input.observability as never } : {}),
    });
  }

  describe("given the typed connection this process opened", () => {
    /** @scenario "A worker holding the tenancy graph composes the model gateway" */
    it("says nothing about a missing tenancy graph", () => {
      const warn = vi.fn();

      compositionWithConnection({
        connection: createWorkerProcessDatabase(),
        observability: { logger: { info: vi.fn(), warn } },
      });

      // Scoped to the gateway's own reason rather than to the logger: this
      // graph declares other absences honestly, and a bare "never warned"
      // would pass only until the next one.
      expect(warn).not.toHaveBeenCalledWith(
        { reason: "no-tenancy" },
        expect.stringContaining("composed no model gateway"),
      );
    });

    /**
     * The licence row lives on the same connection every other read runs on,
     * so a root holding one has no reason to leave the licence leg out. This
     * is the wiring the composition unit cannot see: `createWorkerPlanProvider`
     * takes the store as an option, and a root that stops passing it still
     * composes, still resolves plans, and quietly resolves every licensed
     * customer as unlicensed. The absence it reports is what says so.
     */
    /** @scenario "A worker holding its connection composes the licence source" */
    it("says nothing about a missing licence source, because it composed one", () => {
      const warn = vi.fn();

      compositionWithConnection({
        connection: createWorkerProcessDatabase(),
        observability: { logger: { info: vi.fn(), warn } },
      });

      expect(warn).not.toHaveBeenCalledWith({ source: "licence" }, expect.any(String));
    });
  });

  describe("when the root was given no typed connection", () => {
    /** @scenario "A worker with no tenancy graph composes no model gateway" */
    it("names the missing tenancy graph at boot", () => {
      const warn = vi.fn();

      compositionWithConnection({ observability: { logger: { info: vi.fn(), warn } } });

      expect(warn).toHaveBeenCalledWith(
        { reason: "no-tenancy" },
        expect.stringContaining("composed no model gateway"),
      );
    });
  });
});
