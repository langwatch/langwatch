/**
 * Experiment's run pipeline installed as production composes it: an api and a worker over one
 * event store, one process store and one Redis, with the group queue's semantics in memory.
 * Design: modules/experiment/specs/experiment-run-execution.md section 11.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  EventSourcing,
  InMemoryProcessStore,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  type QueueSendOptions,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  memoryRedisDouble,
  memoryRedisStore,
  type MemoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import type {
  StudioClientEvent,
  StudioServerEvent,
  WorkflowApi,
} from "@langwatch/workflow-contract";

import { experimentServer } from "../../experiment.server.ts";
import type { ExperimentV3RestApi } from "../../transport/experiment-v3.rest.ts";

/** A ClickHouse that holds no rows: every read answers empty, every write lands nowhere. */
class EmptyDriver implements QueryDriver {
  execute<Row>(): Promise<QueryResult<Row>> {
    return Promise.resolve({ rows: [] });
  }

  insert(_request: InsertRequest): Promise<void> {
    return Promise.resolve();
  }

  command(): Promise<void> {
    return Promise.resolve();
  }
}

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** The test database, or nothing where the lane has none. */
export function connectTestDatabase(): PrismaConnection | undefined {
  const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  return PrismaConnectionService.create({
    guard: new AllowTestQueries(),
    logger: createLogger("experiment-run-installation"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
}

type Payload = Record<string, unknown>;
type QueuedJob = { payload: Payload; attempt: number; dueAt: number };

/** What a job on the shared queue is: `command:startExperimentRun`, `projection:...`. */
export function jobOf(payload: Payload): string {
  return `${String(payload.__jobType)}:${String(payload.__jobName)}`;
}

const RETRY_MS = 20;
const MAX_ATTEMPTS = 250;

/**
 * The group queue's contract in memory: a send returns once queued, one job per group runs at a
 * time while groups run side by side, and a failed job is redelivered after a pause.
 */
export class GroupOrderedQueue implements EventSourcedQueueProcessor<Payload> {
  static create(input: {
    definition: EventSourcedQueueDefinition<Payload>;
    redeliver: (payload: Payload) => boolean;
    beforeSend: (payload: Payload) => Promise<void>;
  }): GroupOrderedQueue {
    return new GroupOrderedQueue(input);
  }

  readonly sent: Payload[] = [];
  readonly exhausted: unknown[] = [];
  readonly #definition: EventSourcedQueueDefinition<Payload>;
  readonly #redeliver: (payload: Payload) => boolean;
  readonly #beforeSend: (payload: Payload) => Promise<void>;
  readonly #groups = new Map<string, QueuedJob[]>();
  readonly #active = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(input: {
    definition: EventSourcedQueueDefinition<Payload>;
    redeliver: (payload: Payload) => boolean;
    beforeSend: (payload: Payload) => Promise<void>;
  }) {
    this.#definition = input.definition;
    this.#redeliver = input.redeliver;
    this.#beforeSend = input.beforeSend;
  }

  async send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void> {
    await this.#beforeSend(payload);
    this.sent.push(payload);
    const dueAt = Date.now() + (options?.delay ?? this.#definition.delay ?? 0);
    const group = this.#definition.groupKey?.(payload) ?? "__unknown__";
    const queued = this.#groups.get(group) ?? [];
    queued.push({ payload, attempt: 1, dueAt });
    // A delivery whose acknowledgement was lost: the same job, delivered again after it ran.
    if (this.#redeliver(payload)) queued.push({ payload, attempt: 2, dueAt });
    this.#groups.set(group, queued);
    this.#pump();
  }

  async sendBatch(payloads: Payload[], options?: QueueSendOptions<Payload>): Promise<void> {
    for (const payload of payloads) await this.send(payload, options);
  }

  async waitUntilReady(): Promise<void> {}

  /** Stops scheduling; a job still running (a hung cell) is left where it is. */
  async close(): Promise<void> {
    clearTimeout(this.#timer);
    this.#groups.clear();
  }

  #pump(): void {
    const now = Date.now();
    let nextDue = Number.POSITIVE_INFINITY;
    for (const [group, queued] of this.#groups) {
      const head = queued[0];
      if (!head || this.#active.has(group)) continue;
      if (head.dueAt > now) {
        nextDue = Math.min(nextDue, head.dueAt);
        continue;
      }
      queued.shift();
      void this.#run({ group, job: head });
    }
    if (Number.isFinite(nextDue)) {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#pump(), Math.max(1, nextDue - now));
    }
  }

  async #run({ group, job }: { group: string; job: QueuedJob }): Promise<void> {
    this.#active.add(group);
    try {
      await this.#definition.process(job.payload, { attempt: job.attempt });
    } catch (error) {
      if (job.attempt >= MAX_ATTEMPTS) {
        this.exhausted.push(error);
      } else {
        const queued = this.#groups.get(group) ?? [];
        queued.unshift({ ...job, attempt: job.attempt + 1, dueAt: Date.now() + RETRY_MS });
        this.#groups.set(group, queued);
      }
    } finally {
      this.#active.delete(group);
      this.#pump();
    }
  }
}

/** One dispatch the engine received from a cell. */
export type EngineDispatch = Readonly<{
  type: StudioClientEvent["type"];
  nodeId: string;
  inputs: unknown;
  sandboxKey: unknown;
}>;

/** How the engine answers a dispatch: the events it streams back, after however long it takes. */
export type EngineAnswer = (dispatch: EngineDispatch) => Promise<StudioServerEvent[]>;

/** The Studio engine behind `WorkflowApi.postStudioEvent`, counting what is in flight at once. */
export function studioEngine(answer: EngineAnswer) {
  const dispatched: EngineDispatch[] = [];
  const engine = {
    dispatched,
    inFlight: 0,
    maxInFlight: 0,
    postStudioEvent: async ({
      event,
      onEvent,
    }: Parameters<WorkflowApi["postStudioEvent"]>[0]): Promise<void> => {
      const dispatch: EngineDispatch = {
        type: event.type,
        nodeId: "node_id" in event.payload ? String(event.payload.node_id) : "",
        inputs: "inputs" in event.payload ? event.payload.inputs : undefined,
        sandboxKey:
          "workflow" in event.payload ? event.payload.workflow.sandbox_api_key : undefined,
      };
      engine.dispatched.push(dispatch);
      engine.inFlight += 1;
      engine.maxInFlight = Math.max(engine.maxInFlight, engine.inFlight);
      try {
        for (const answered of await answer(dispatch)) onEvent(answered);
      } finally {
        engine.inFlight -= 1;
      }
    },
  };
  return engine;
}

export type StudioEngine = ReturnType<typeof studioEngine>;

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A node that answers with its outputs, and optionally the metrics its model reported. */
export function succeeds(
  nodeId: string,
  outputs: Record<string, unknown>,
  metrics?: Record<string, unknown>,
): StudioServerEvent[] {
  return [
    {
      type: "component_state_change",
      payload: {
        component_id: nodeId,
        execution_state: { status: "success", outputs, ...(metrics ? { metrics } : {}) },
      },
    },
  ];
}

/** A node that answers with an error. */
export function fails(nodeId: string, error: string): StudioServerEvent[] {
  return [
    {
      type: "component_state_change",
      payload: { component_id: nodeId, execution_state: { status: "error", error } },
    },
  ];
}

export type PeerOverrides = Partial<{
  agent: AgentApi;
  suite: SuiteApi;
  entitlement: EntitlementApi;
  "model-provider": ModelProviderApi;
  "api-key": ApiKeyApi;
  project: ProjectApi;
  evaluation: EvaluationApi;
}>;

/** Every peer experiment depends on, each throwing by name on anything a test did not script. */
function peersOf(overrides: PeerOverrides) {
  return {
    dataset: createApiFixture<DatasetApi>({}),
    monitor: createApiFixture<MonitorApi>({}),
    agent: createApiFixture<AgentApi>({}),
    evaluator: createApiFixture<EvaluatorApi>({}),
    prompt: createApiFixture<PromptApi>({}),
    authz: createApiFixture<AuthzApi>({}),
    presence: createApiFixture<PresenceApi>({}),
    project: createApiFixture<ProjectApi>({
      getOrganizationId: async () => "organization_1",
      findOrganizationId: async () => "organization_1",
    }),
    entitlement: createApiFixture<EntitlementApi>({ requestBound: async () => 1_000 }),
    evaluation: createApiFixture<EvaluationApi>({ reportEvaluation: async () => {} }),
    "api-key": createApiFixture<ApiKeyApi>({
      mintRunKey: async ({ permissions }) =>
        permissions.includes("agentCache:manage") ? "sandbox-key" : "run-key",
    }),
    suite: createApiFixture<SuiteApi>({ assertConnectedAgentsRunnable: async () => {} }),
    "stored-object": createApiFixture<StoredObjectApi>({}),
    "model-provider": createApiFixture<ModelProviderApi>({
      listCosts: async () => [],
      estimateCost: () => 0,
    }),
    "data-retention": createApiFixture<DataRetentionApi>({
      getPlatformDefaultRetentionDays: () => 49,
    }),
    ...overrides,
  };
}

function boot({
  role,
  eventing,
  database,
  redis,
  publicBaseUrl,
  runConcurrency,
  peers,
  workflow,
}: {
  role: "api" | "worker";
  eventing: EventSourcing;
  database: PrismaConnection;
  redis: MemoryRedisStore;
  publicBaseUrl: string | undefined;
  runConcurrency: number;
  peers: PeerOverrides;
  workflow: WorkflowApi;
}) {
  const app = createApp({ role })
    .withModules([experimentServer])
    .withStores(memoryStores())
    .withEventing(eventing)
    .withRelational(database.client)
    .withAnalytical(new ClickHouseQueryClient({ driver: new EmptyDriver() }))
    .withConfig({
      experiment: { blockLocalHttpCalls: false, allowedProxyHosts: [], runConcurrency },
    })
    .withMember("publicBaseUrl", publicBaseUrl)
    .withMember("processName", `langwatch-test-${role}`)
    .withMember("isSaas", false)
    .withObservability((observability) => observability.withLogging(createTestLogger().logger));

  return app
    .withKeyvalue(memoryRedisDouble({ store: redis }))
    .provide({ ...peersOf(peers), workflow })
    .boot();
}

export type RunPairOptions = Readonly<{
  database: PrismaConnection;
  /** What the worker's engine answers each dispatch with. */
  answer?: EngineAnswer;
  /** The workflow reads both roles make, and what only the worker's differ in. */
  workflow?: Partial<WorkflowApi>;
  workerWorkflow?: Partial<WorkflowApi>;
  /** The worker's peers, over the defaults. */
  worker?: PeerOverrides;
  /** The api's peers, over the defaults. */
  api?: PeerOverrides;
  /** Jobs delivered twice, as a lost acknowledgement would. */
  redeliver?: (payload: Payload) => boolean;
  /** Awaited as each job is queued, before the queue takes it. */
  beforeSend?: (payload: Payload) => Promise<void>;
  publicBaseUrl?: string | undefined;
  runConcurrency?: number;
}>;

/** What the kernel hands experiment's transports: its contract plus the workbench's doors. */
type InstalledExperiment = ExperimentApi & ExperimentV3RestApi;
const WORKBENCH_DOORS = ["executeWorkbenchRun", "abortWorkbenchRun", "pollRun", "startSavedRun"];

function isInstalledExperiment(provided: ExperimentApi): provided is InstalledExperiment {
  return WORKBENCH_DOORS.every((door) => typeof Reflect.get(provided, door) === "function");
}

function installedExperimentOf(provided: ExperimentApi): InstalledExperiment {
  if (!isInstalledExperiment(provided)) throw new Error("experiment serves no workbench doors");
  return provided;
}

/** An api and a worker sharing one event store, process store, Redis and queue. */
export async function bootRunPair(options: RunPairOptions) {
  const redis = memoryRedisStore();
  const eventStore = EventStoreMemory.createForTesting();
  const processStore = InMemoryProcessStore.createForTesting();
  const engine = studioEngine(options.answer ?? (async () => []));
  const queues: GroupOrderedQueue[] = [];
  const queue = (): GroupOrderedQueue => {
    const shared = queues[0];
    if (!shared) throw new Error("the worker's queue is not built yet");
    return shared;
  };
  const workerEventing = new EventSourcing({
    eventStore,
    processStore,
    executionTarget: "worker",
    consumersEnabled: true,
    queueFactory: (definition) => {
      const built = GroupOrderedQueue.create({
        definition,
        redeliver: options.redeliver ?? (() => false),
        beforeSend: options.beforeSend ?? (async () => {}),
      });
      queues.push(built);
      return built;
    },
  });
  const apiEventing = new EventSourcing({
    eventStore,
    processStore,
    executionTarget: "api",
    consumersEnabled: false,
    processManagerMode: "producer-only",
    queueFactory: () => ({
      send: (payload, sendOptions) => queue().send(payload, sendOptions),
      sendBatch: (payloads, sendOptions) => queue().sendBatch(payloads, sendOptions),
      waitUntilReady: async () => {},
      close: async () => {},
    }),
  });
  const publicBaseUrl =
    "publicBaseUrl" in options ? options.publicBaseUrl : "https://app.langwatch.test";
  const shared = {
    database: options.database,
    publicBaseUrl,
    runConcurrency: options.runConcurrency ?? 10,
  };
  const worker = await boot({
    ...shared,
    role: "worker",
    eventing: workerEventing,
    redis,
    peers: {
      ...options.worker,
    },
    workflow: createApiFixture<WorkflowApi>({
      postStudioEvent: engine.postStudioEvent,
      prepareStudioEvent: async ({ event }) => event,
      enrichStudioEvent: async ({ event }) => event,
      ...options.workflow,
      ...options.workerWorkflow,
    }),
  });
  const api = await boot({
    ...shared,
    role: "api",
    eventing: apiEventing,
    redis,
    peers: options.api ?? {},
    workflow: createApiFixture<WorkflowApi>({ ...options.workflow }),
  });

  return {
    api: installedExperimentOf(api.module(experimentServer).provided),
    worker: installedExperimentOf(worker.module(experimentServer).provided),
    engine,
    queue,
    /** The jobs of one kind the queue was sent, in order. */
    sentJobs: (job: string) => queue().sent.filter((payload) => jobOf(payload) === job),
    stop: async () => {
      await api.stop();
      await worker.stop();
    },
  };
}

export type RunPair = Awaited<ReturnType<typeof bootRunPair>>;
