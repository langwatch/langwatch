/**
 * The event-sourcing member, and the role factories a process states one with.
 * A role says which half of event sourcing it runs; the queue underneath is
 * the same everywhere and is settled here, over this process's one Redis.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  createEventingGroupQueueFactory,
  type EventingParticipation,
  EventLogReadSeat,
  type EventReadSeat,
  EventSourcing,
  type EventSourcingOptions,
  type EventStore,
  EventStoreProducerOnly,
  pipelineUpcastsOf,
  type ProcessStore,
  replayLeanOf,
  ReplayService,
  unionReplayTenants,
  upcastReplayEventSource,
} from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createEventingRetentionConfiguration,
  createProcessManagerMaintenancePipeline,
  createReadHintsPipeline,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  EventingClickHouseReplayEventSource,
  OtelProcessRetentionMetricsAdapter,
  PrismaProcessStore,
  type EventingClickHouseClientResolver,
} from "@langwatch/eventing/server";
import {
  GroupQueueDependenciesAdapter,
  type GroupQueueContext,
  type GroupQueueContextMetadata,
} from "@langwatch/group-queue";
import { BlobSweeper } from "@langwatch/group-queue/operational";
import {
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "@langwatch/observability/context";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

import type { EventingConfig, EventingGroupQueueConfig, EventingStoreConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";

/** The event log a draining role reads. */
export interface EventingEventLogMembers {
  readonly clickhouse: ClickHouseQueryClient;
}

/**
 * The runtime, over the store and queue the role named. Built with the clients
 * this process already opened, so the reverse close order drains the queue
 * before the connection under it goes away.
 */
export function buildEventing(options: {
  readonly config: EventingConfig;
  /** Names this process in a producer-only store's refusals. */
  readonly processName: string;
  /** Holds the process store every role reads and writes, the producer too. */
  readonly prisma: PrismaClient;
  /** Absent where the role states no queue, which runs projections inline. */
  readonly redis?: RedisConnection;
  /**
   * The event log's ClickHouse. A draining role appends through it; any role given it reads one
   * event by id through a seat beside its store, which a producer's store still refuses (Q209).
   */
  readonly eventLog?: EventingEventLogMembers;
  /** Overrides the half this process's role would otherwise install. */
  readonly participation?: EventingParticipation;
  /** The tenant directory's privately routed tenants, which a replay lists beside the log's. */
  readonly privateTenants?: () => AsyncIterable<string>;
}): BuiltMember<EventSourcing> {
  const { config } = options;
  const processStore = PrismaProcessStore.create({ database: options.prisma });
  const eventStore = eventingEventStore({
    store: config.store,
    processName: options.processName,
    ...(options.eventLog === undefined ? {} : { eventLog: options.eventLog }),
  });
  const eventReadSeat =
    options.eventLog === undefined ? undefined : eventingReadSeat(options.eventLog);
  const queueFactory =
    config.groupQueue === undefined || options.redis === undefined
      ? undefined
      : eventingQueueFactory({
          queue: config.groupQueue,
          redis: options.redis,
          consumersEnabled: config.consumersEnabled,
        });

  const eventing = new EventSourcing({
    enabled: true,
    eventStore,
    ...(eventReadSeat === undefined ? {} : { eventReadSeat }),
    consumersEnabled: config.consumersEnabled,
    executionTarget: config.executionTarget,
    processManagerMode: config.processManagerMode ?? "run",
    warnWhenProjectionsRunInline: false,
    ...(options.participation === undefined ? {} : { participation: options.participation }),
    ...(queueFactory === undefined ? {} : { queueFactory }),
    processStore,
    ...(options.redis === undefined
      ? {}
      : {
          maintenance: eventingMaintenance({ redis: options.redis, processStore }),
          readHints: readHintsOver(options.redis),
        }),
    ...(options.redis === undefined || options.eventLog === undefined
      ? {}
      : {
          replayEngine: replayEngineOver({
            redis: options.redis,
            clickhouse: options.eventLog.clickhouse,
            ...(options.privateTenants === undefined
              ? {}
              : { privateTenants: options.privateTenants }),
          }),
        }),
  });

  return { value: eventing, close: () => eventing.close() };
}

/**
 * The queue's blob sweep and the process managers' inbox/outbox retention. The
 * retention reaps by predicate across every process name, so it covers ones added later.
 */
function eventingMaintenance({
  redis,
  processStore,
}: {
  readonly redis: RedisConnection;
  readonly processStore: ProcessStore;
}): NonNullable<EventSourcingOptions["maintenance"]> {
  const sweeper = new BlobSweeper({ redis });
  return () => [
    createBlobMaintenancePipeline({
      cleanup: {
        sweep: () => sweeper.sweep(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
    }),
    createProcessManagerMaintenancePipeline({
      retentionSweep: {
        deleteDispatchedOutboxBatch: (params) => processStore.deleteDispatchedOutboxBatch(params),
        deleteDeadOutboxBatch: (params) => processStore.deleteDeadOutboxBatch(params),
        deleteConsumedInboxBatch: (params) => processStore.deleteConsumedInboxBatch(params),
        metrics: OtelProcessRetentionMetricsAdapter.create(),
      },
    }),
  ];
}

/** The read-hint subscriber, publishing on this process's Redis (read-hints.feature). */
function readHintsOver(redis: RedisConnection): NonNullable<EventSourcingOptions["readHints"]> {
  return ({ hinted, declaredEventTypes }) =>
    createReadHintsPipeline({
      hinted,
      declaredEventTypes,
      publish: (channel, message) => redis.publish(channel, message),
    });
}

/**
 * One replay run's engine: the event log through the routed member, markers on a standalone
 * Redis connection sharing no socket with live traffic. A Cluster refuses replay's multi-key
 * operations (CROSSSLOT), as on main.
 */
function replayEngineOver({
  redis,
  clickhouse,
  privateTenants,
}: {
  readonly redis: RedisConnection;
  readonly clickhouse: ClickHouseQueryClient;
  readonly privateTenants?: () => AsyncIterable<string>;
}): NonNullable<EventSourcingOptions["replayEngine"]> {
  return ({ definitions, retentionPolicyResolver }) => {
    if (redis.isCluster) {
      throw new Error(
        "Replay requires a standalone Redis: a Cluster refuses its multi-key operations.",
      );
    }
    const connection = redis.duplicate();
    const logSource = upcastReplayEventSource({
      source: new EventingClickHouseReplayEventSource({
        clickhouse,
        lean: replayLeanOf(definitions),
      }),
      upcasts: pipelineUpcastsOf(definitions),
    });
    const service = new ReplayService({
      eventSource:
        privateTenants === undefined
          ? logSource
          : unionReplayTenants({ source: logSource, listTenants: privateTenants }),
      redis: connection,
      ...(retentionPolicyResolver === undefined ? {} : { retentionPolicyResolver }),
    });
    return {
      service,
      close: async () => {
        connection.disconnect();
      },
    };
  };
}

/** Where this role appends: a producer refuses reads, a draining role reads the event log. */
function eventingEventStore(options: {
  readonly store: EventingStoreConfig;
  readonly processName: string;
  readonly eventLog?: EventingEventLogMembers;
}): EventStore {
  if (options.store.kind === "producer-only") {
    return EventStoreProducerOnly.create({ processName: options.processName });
  }
  const eventLog = options.eventLog;
  if (!eventLog) {
    throw new Error(
      `${options.processName} drains the event log, which needs this process's ClickHouse member.`,
    );
  }

  const retention = createEventingRetentionConfiguration({
    defaultRetentionDays: options.store.defaultRetentionDays,
  });
  return EventingClickHouseEventStore.create({
    repository: EventingClickHouseEventRepository.create({
      resolveClient: eventingClickHouseResolver(eventLog.clickhouse),
      retention,
    }),
    retention,
  });
}

/** One event by id over the event log, whichever store this role appends through. */
function eventingReadSeat(eventLog: EventingEventLogMembers): EventReadSeat {
  return EventLogReadSeat.create({
    repository: EventingClickHouseEventRepository.createForEventReads({
      resolveClient: eventingClickHouseResolver(eventLog.clickhouse),
    }),
  });
}

/**
 * Adapts the routed process member to Eventing's tenant-resolved client. The
 * read runs where the caller names its row type — the only point at which this
 * seam knows what it reads back, and where every caller awaits it, once.
 */
function eventingClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): EventingClickHouseClientResolver {
  return (tenantId) =>
    Promise.resolve({
      query: (request) =>
        Promise.resolve({
          json: <Row>() =>
            clickhouse
              .query<Row>({
                tenantId,
                sql: request.query,
                ...(request.query_params === undefined ? {} : { params: request.query_params }),
              })
              .then((result) => result.rows),
        }),
      insert: (request) =>
        clickhouse.insert({
          tenantId,
          table: request.table,
          rows: request.values,
          settings: request.clickhouse_settings,
        }),
    });
}

/** The Group Queue this role dispatches through, as Eventing's queue port. */
function eventingQueueFactory(options: {
  readonly queue: EventingGroupQueueConfig;
  readonly redis: RedisConnection;
  readonly consumersEnabled: boolean;
}): EventSourcingOptions["queueFactory"] {
  const dependencies = GroupQueueDependenciesAdapter.create({
    redis: options.redis,
    context: ProcessQueueContext.create(),
    ...(options.queue.policy === undefined ? {} : { policy: options.queue.policy }),
    ...(options.queue.storage === undefined ? {} : { storage: options.queue.storage }),
  }).dependencies();

  return createEventingGroupQueueFactory({
    dependencies,
    consumersEnabled: options.consumersEnabled,
  });
}

/**
 * The process's own log context, carried onto the queue and restored around a
 * handler, so a job's lines name the trace, project and person the send did.
 * Queue-owned spans link themselves; only the logged fields are restored here.
 */
class ProcessQueueContext implements GroupQueueContext {
  static create(): ProcessQueueContext {
    return new ProcessQueueContext();
  }

  private constructor() {}

  capture(): GroupQueueContextMetadata {
    const metadata = getJobContextMetadata();
    return {
      traceId: metadata.traceId,
      parentSpanId: metadata.parentSpanId,
      organizationId: metadata.organizationId,
      projectId: metadata.projectId,
      userId: metadata.userId,
    };
  }

  run<Result>(
    metadata: GroupQueueContextMetadata | undefined,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return runWithContext(createContextFromJobData(metadata), operation);
  }
}
