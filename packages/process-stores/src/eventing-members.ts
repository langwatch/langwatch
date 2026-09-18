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
  type ExecutionTarget,
  type ProcessStore,
} from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  PrismaProcessStore,
  type EventingClickHouseClientResolver,
} from "@langwatch/eventing/server";
import {
  GroupQueueDependenciesAdapter,
  type GroupQueueContext,
  type GroupQueueContextMetadata,
  type GroupQueuePolicy,
  type GroupQueueStorage,
} from "@langwatch/group-queue";
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

/**
 * What either role states beyond the half of event sourcing it runs. Neither
 * names `participation`: which half a process installs follows its role, and
 * these factories name only the substrate that half needs.
 */
interface EventingRoleOptions {
  /** Which tier a command this process sends records as its origin. */
  readonly executionTarget: ExecutionTarget;
  /** Retry, lease and concurrency shape. Absent uses the queue's own. */
  readonly queuePolicy?: GroupQueuePolicy;
  /** Where an oversized payload's body is offloaded. Absent keeps it inline. */
  readonly storage?: GroupQueueStorage;
}

/**
 * A role that sends commands and drains none of them: its store refuses every
 * read by name, and the process managers its pipelines declare are registered
 * without being run, so the role that claims the queue runs them exactly once.
 */
export function producerEventing(options: EventingRoleOptions): EventingConfig {
  return {
    store: { kind: "producer-only" },
    consumersEnabled: false,
    executionTarget: options.executionTarget,
    processManagerMode: "producer-only",
    groupQueue: groupQueueConfig(options),
  };
}

/**
 * The role that claims the queue: it folds projections, runs subscribers and
 * owns the process managers, so it reads the event log rather than refusing.
 */
export function consumingEventing(
  options: EventingRoleOptions & {
    /** The fallback retention for rows whose tenant states none, in days. */
    readonly defaultRetentionDays: number;
  },
): EventingConfig {
  return {
    store: { kind: "event-log", defaultRetentionDays: options.defaultRetentionDays },
    consumersEnabled: true,
    executionTarget: options.executionTarget,
    processManagerMode: "run",
    groupQueue: groupQueueConfig(options),
  };
}

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
  });

  return { value: eventing, close: () => eventing.close() };
}

/** The queue this role dispatches through, as every role states one. */
function groupQueueConfig(options: EventingRoleOptions): EventingGroupQueueConfig {
  return {
    ...(options.queuePolicy === undefined ? {} : { policy: options.queuePolicy }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  };
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
