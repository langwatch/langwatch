/**
 * The event-sourcing member, and the role factories a process states one with.
 * A role says which half of event sourcing it runs; the queue underneath is
 * the same everywhere and is settled here, over this process's one Redis.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  createEventingGroupQueueFactory,
  EventSourcing,
  EventStoreProducerOnly,
  type EventStore,
  type EventSourcingOptions,
  type ProcessStore,
} from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createEventingRetentionConfiguration,
  createProcessManagerMaintenancePipeline,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
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
import type { EventingParticipation } from "@langwatch/kernel";
import {
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "@langwatch/observability/context";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

import type { EventingConfig, EventingGroupQueueConfig, EventingStoreConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";

/** The event log and the process state a draining role reads and leases. */
export interface EventingEventLogMembers {
  readonly prisma: PrismaClient;
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
  /** Absent where the role states no queue, which runs projections inline. */
  readonly redis?: RedisConnection;
  /** Absent on a role that drains nothing and so reads no event log. */
  readonly eventLog?: EventingEventLogMembers;
  /** Overrides the half this process's role would otherwise install. */
  readonly participation?: EventingParticipation;
}): BuiltMember<EventSourcing> {
  const { config } = options;
  const stores = eventingStores({
    store: config.store,
    processName: options.processName,
    ...(options.eventLog === undefined ? {} : { eventLog: options.eventLog }),
  });
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
    eventStore: stores.eventStore,
    consumersEnabled: config.consumersEnabled,
    executionTarget: config.executionTarget,
    processManagerMode: config.processManagerMode ?? "run",
    warnWhenProjectionsRunInline: false,
    ...(options.participation === undefined ? {} : { participation: options.participation }),
    ...(queueFactory === undefined ? {} : { queueFactory }),
    ...(stores.processStore === undefined ? {} : { processStore: stores.processStore }),
    ...(config.killSwitch === undefined ? {} : { killSwitch: config.killSwitch }),
    ...(options.redis === undefined || stores.processStore === undefined
      ? {}
      : {
          maintenance: eventingMaintenance({
            redis: options.redis,
            processStore: stores.processStore,
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

/** Where this role appends, and the durable state it leases while draining. */
function eventingStores(options: {
  readonly store: EventingStoreConfig;
  readonly processName: string;
  readonly eventLog?: EventingEventLogMembers;
}): { readonly eventStore: EventStore; readonly processStore?: ProcessStore } {
  if (options.store.kind === "producer-only") {
    return { eventStore: EventStoreProducerOnly.create({ processName: options.processName }) };
  }
  const eventLog = options.eventLog;
  if (!eventLog) {
    throw new Error(
      `${options.processName} drains the event log, which needs this process's Postgres and ClickHouse members.`,
    );
  }

  const retention = createEventingRetentionConfiguration({
    defaultRetentionDays: options.store.defaultRetentionDays,
  });
  return {
    eventStore: EventingClickHouseEventStore.create({
      repository: EventingClickHouseEventRepository.create({
        resolveClient: eventingClickHouseResolver(eventLog.clickhouse),
        retention,
      }),
      retention,
    }),
    processStore: PrismaProcessStore.create({ database: eventLog.prisma }),
  };
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
