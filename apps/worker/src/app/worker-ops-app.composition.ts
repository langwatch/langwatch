/**
 * The worker's complete Ops application.
 *
 * This is deliberately a declaration builder rather than a second application
 * root. Boot allocates User, Auth and Project API clients before any App is
 * constructed, which lets this capability retain those peers without reading
 * one during construction. The Eventing registry remains lazy for the same
 * reason: features register pipelines for the rest of boot, and replay reads
 * the complete registry only when an operator starts a run.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  ReplayService as EventingReplayService,
  type EventSourcing,
  type RegisteredFoldProjection,
  type RegisteredMapProjection,
  type RegisteredStateProjection,
} from "@langwatch/eventing";
import {
  EventingClickHouseReplayEventSource,
  PrismaScheduledJobStore,
  type EventingClickHouseReplayClientResolver,
} from "@langwatch/eventing/server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  AdminAuditSink,
  EventExplorerClickHouseRepository,
  EventExplorerService,
  EventingOpsIntrospectionAdapter,
  IoredisOpsSnapshotRedisAdapter,
  ManagerExplorerService,
  OpsReplayRuntimePort,
  type OpsAppDependencies,
  OpsOperations,
  PrismaProcessAuditRepository,
  ProcessOpsPrismaRepository,
  QueuePayloadDecoder,
  DefaultOpsSnapshotService,
  RedisOpsSnapshotRepository,
  RedisSchedulerWakeAdapter,
  ReplayService,
  type ReplayRepository,
} from "@langwatch/ops-server";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  IDLE_STATUS,
  type ReplayHistoryEntry,
  type ReplayStatus,
  replayHistoryEntrySchema,
  replayStatusSchema,
} from "@langwatch/ops-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ApplicationBuilder } from "@langwatch/runtime-composition";
import type { ProcessStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";
import { opsServer } from "@langwatch/ops-server";
import { z } from "zod";

const auditMetadataSchema = z.object({
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  remoteAddress: z.string().nullable(),
});

const auditArgsSchema = z.record(z.string(), z.json());

/** Inputs held by the worker root; every one is an already-composed process substrate or API. */
export type WorkerOpsAppCompositionOptions = Readonly<{
  connection: PrismaConnection;
  redis: RedisConnection;
  eventLogClient: ClickHouseClient;
  resolveReplayClient: EventingClickHouseReplayClientResolver;
  eventing: EventSourcing;
  processStore: ProcessStore;
  featureFlags: FeatureFlagApi;
  adminEmails: string;
}>;

/**
 * Adds the canonical Ops App to the worker's one application builder.
 *
 * `opsServer` owns the public `OpsApi` token. Calling this function only
 * declares its construction; `ApplicationBuilder.boot()` builds one instance
 * after all peer API clients have been allocated.
 */
export function installWorkerOps<Infrastructure>(
  builder: ApplicationBuilder<Infrastructure>,
  options: WorkerOpsAppCompositionOptions,
): ApplicationBuilder<Infrastructure> {
  const database = options.connection.client;
  const introspection = EventingOpsIntrospectionAdapter.create(() => options.eventing.definitions);
  const snapshots = DefaultOpsSnapshotService.create(
    RedisOpsSnapshotRepository.create(IoredisOpsSnapshotRedisAdapter.create(options.redis)),
  );
  return builder.withModule(opsServer, {
    infrastructure: {
      createCapability: (peers: OpsAppDependencies) => {
        const operations = OpsOperations.create({
          adminEmails: options.adminEmails,
          database,
          audit: WorkerOpsAuditSink.create({ auditLog: peers.auditLog }),
          auditLog: peers.auditLog,
          redis: options.redis,
          queuePayloads: WorkerOpsQueuePayloadDecoder.create(),
          users: peers.users,
          auth: peers.auth,
          scheduler: {
            repository: new PrismaScheduledJobStore(database),
            wake: RedisSchedulerWakeAdapter.create(options.redis),
            projects: peers.projects,
          },
        }).build();
        const replay = ReplayService.create({
          repo: WorkerReplayRepository.create(options.redis),
          runtimeFactory: WorkerOpsReplayRuntime.create({
            eventing: options.eventing,
            redis: options.redis,
            resolveClient: options.resolveReplayClient,
          }),
        });

        return Object.assign(operations, {
          eventExplorer: EventExplorerService.create({
            repo: EventExplorerClickHouseRepository.create({ client: options.eventLogClient }),
            introspection,
          }),
          managerExplorer: ManagerExplorerService.create({
            store: options.processStore,
            fleet: ProcessOpsPrismaRepository.create({ prisma: database }),
            audit: PrismaProcessAuditRepository.create({
              prisma: database,
              auditLog: peers.auditLog,
            }),
            introspection,
          }),
          replay,
          snapshots,
        });
      },
      featureFlags: options.featureFlags,
      eventingIntrospection: introspection,
    },
  });
}

/** Persists worker-issued administrator actions in the same audit ledger as the API. */
class WorkerOpsAuditSink extends AdminAuditSink {
  static create({ auditLog }: { auditLog: AuditLogApi }): WorkerOpsAuditSink {
    return new WorkerOpsAuditSink(auditLog);
  }

  private constructor(private readonly auditLog: AuditLogApi) {
    super();
  }

  async record(input: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: { headers: Record<string, string | string[]>; remoteAddress?: string };
  }): Promise<void> {
    await this.auditLog.record({
      userId: input.userId,
      action: input.action,
      args: auditArgsSchema.parse(input.args),
      metadata: auditMetadataSchema.parse({
        headers: input.req.headers,
        remoteAddress: input.req.remoteAddress ?? null,
      }),
    });
  }
}

/** The replay lease, status and history share the worker's actual Redis connection. */
class WorkerReplayRepository implements ReplayRepository {
  static create(redis: RedisConnection): WorkerReplayRepository {
    return new WorkerReplayRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async getStatus(): Promise<ReplayStatus> {
    const raw = await this.redis.get("ops:replay:status");
    if (!raw) return { ...IDLE_STATUS };
    return replayStatusSchema.safeParse(parseJson(raw)).data ?? { ...IDLE_STATUS };
  }

  async writeStatus(input: { status: ReplayStatus }): Promise<void> {
    await this.redis.set("ops:replay:status", JSON.stringify(input.status), "EX", 7200);
  }

  async acquireLock(input: { runId: string; ttlSeconds: number }): Promise<boolean> {
    return (
      (await this.redis.set("ops:replay:lock", input.runId, "EX", input.ttlSeconds, "NX")) !== null
    );
  }

  async refreshLock(input: { runId: string; ttlSeconds: number }): Promise<boolean> {
    return (
      (await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end return 0",
        1,
        "ops:replay:lock",
        input.runId,
        String(input.ttlSeconds),
      )) === 1
    );
  }

  async releaseLock(input: { runId: string }): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      "ops:replay:lock",
      input.runId,
    );
  }

  tryGetLockHolder(): Promise<string | null> {
    return this.redis.get("ops:replay:lock");
  }

  async isCancelled(): Promise<boolean> {
    return (await this.redis.get("ops:replay:cancel")) === "1";
  }

  async setCancelled(input: { ttlSeconds: number }): Promise<void> {
    await this.redis.set("ops:replay:cancel", "1", "EX", input.ttlSeconds);
  }

  async clearCancelFlag(): Promise<void> {
    await this.redis.del("ops:replay:cancel");
  }

  async pushToHistory(input: { entry: ReplayHistoryEntry }): Promise<void> {
    await this.redis.lpush("ops:replay:history", JSON.stringify(input.entry));
    await this.redis.ltrim("ops:replay:history", 0, 49);
  }

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    const history = await this.redis.lrange("ops:replay:history", 0, 49);
    return history.flatMap((entry) => {
      const parsed = replayHistoryEntrySchema.safeParse(parseJson(entry));
      return parsed.success ? [parsed.data] : [];
    });
  }
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/** Ops inspection decodes ordinary JSON jobs while preserving opaque envelopes as unreadable. */
class WorkerOpsQueuePayloadDecoder extends QueuePayloadDecoder {
  static create(): WorkerOpsQueuePayloadDecoder {
    return new WorkerOpsQueuePayloadDecoder();
  }

  private constructor() {
    super();
  }

  async tryDecode(input: {
    queueName: string;
    value: string;
  }): Promise<Record<string, unknown> | null> {
    void input.queueName;
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(input.value));
    return parsed.success ? parsed.data : null;
  }
}

/** A fresh replay engine per run, over the live worker registry and shared Redis markers. */
class WorkerOpsReplayRuntime extends OpsReplayRuntimePort {
  static create(input: {
    eventing: EventSourcing;
    redis: RedisConnection;
    resolveClient: EventingClickHouseReplayClientResolver;
  }): WorkerOpsReplayRuntime {
    return new WorkerOpsReplayRuntime(input);
  }

  private constructor(
    private readonly input: {
      eventing: EventSourcing;
      redis: RedisConnection;
      resolveClient: EventingClickHouseReplayClientResolver;
    },
  ) {
    super();
  }

  create() {
    const projections = replayProjections(this.input.eventing);
    return {
      service: new EventingReplayService({
        eventSource: new EventingClickHouseReplayEventSource({
          resolveClient: this.input.resolveClient,
          lean: (event) => event,
        }),
        redis: this.input.redis,
      }),
      ...projections,
      close: async () => {},
    };
  }
}

function replayProjections(eventing: EventSourcing): {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  stateProjections: RegisteredStateProjection[];
} {
  const projections: RegisteredFoldProjection[] = [];
  const mapProjections: RegisteredMapProjection[] = [];
  const stateProjections: RegisteredStateProjection[] = [];

  for (const definition of eventing.definitions) {
    const { name: pipelineName, aggregateType } = definition.metadata;
    for (const { definition: projection } of definition.foldProjections.values()) {
      projections.push({
        projectionName: projection.name,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: projection,
        pauseKey: `${pipelineName}/projection/${projection.name}`,
        kind: "fold",
      });
    }
    for (const { definition: projection } of definition.mapProjections.values()) {
      mapProjections.push({
        projectionName: projection.name,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: projection,
        pauseKey: `${pipelineName}/handler/${projection.name}`,
        kind: "map",
      });
    }
    for (const [projectionName, projection] of definition.stateProjections?.entries() ?? []) {
      stateProjections.push({
        projectionName,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: projection,
        pauseKey: `${pipelineName}/stateProjection/${projectionName}`,
        kind: "state",
      });
    }
  }

  return { projections, mapProjections, stateProjections };
}
