import type { GroupQueueDependencies } from "@langwatch/group-queue";
import type { RetentionPolicyResolver } from "../runtime.types";
import { createEventingGroupQueueFactory } from "../queues/groupQueueFactory";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../queues/queue.types";
import type { EventStore } from "../stores/eventStore.types";
import { EventingClickHouseEventRepository } from "./adapters/clickhouse/event-repository.clickhouse";
import { EventingClickHouseEventStore } from "./adapters/clickhouse/event-store.clickhouse";
import { PrismaProcessStore } from "./adapters/postgres/prisma-process-store";
import type { EventingClickHouseClientResolver } from "./clickhouse-client-resolver";
import type { EventingProcessPersistenceDatabase } from "./process-persistence.database";
import type { EventingRetentionConfiguration } from "./retention";
import type { ProcessStore } from "../process-manager/stores/processStore.types";

export interface EventingServerRuntimeOptions {
  database: EventingProcessPersistenceDatabase;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  groupQueue: GroupQueueDependencies<Record<string, unknown>>;
  retention: EventingRetentionConfiguration;
  retentionPolicyResolver?: RetentionPolicyResolver;
  consumersEnabled?: boolean;
}

export interface EventingServerRuntimeDependencies {
  eventStore: EventStore;
  processStore: ProcessStore;
  queueFactory(
    definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>>;
  retentionPolicyResolver?: RetentionPolicyResolver;
}

/**
 * Production Eventing composition. Dependencies are constructed once at the
 * process root and the Group Queue dependency object passes through intact.
 */
export class EventingServerRuntime {
  static create(options: EventingServerRuntimeOptions): EventingServerRuntime {
    const repository = EventingClickHouseEventRepository.create({
      resolveClient: options.resolveClickHouseClient,
      retention: options.retention,
    });
    const eventStore = EventingClickHouseEventStore.create({
      repository,
      retention: options.retention,
      retentionPolicyResolver: options.retentionPolicyResolver,
    });
    const processStore = PrismaProcessStore.create({ database: options.database });
    const queueFactory = createEventingGroupQueueFactory({
      dependencies: options.groupQueue,
      consumersEnabled: options.consumersEnabled,
    });
    return new EventingServerRuntime({
      eventStore,
      processStore,
      queueFactory,
      retentionPolicyResolver: options.retentionPolicyResolver,
    });
  }

  readonly eventStore: EventStore;
  readonly processStore: ProcessStore;
  readonly queueFactory: EventingServerRuntimeDependencies["queueFactory"];
  readonly retentionPolicyResolver: RetentionPolicyResolver | undefined;

  private constructor(dependencies: EventingServerRuntimeDependencies) {
    this.eventStore = dependencies.eventStore;
    this.processStore = dependencies.processStore;
    this.queueFactory = dependencies.queueFactory;
    this.retentionPolicyResolver = dependencies.retentionPolicyResolver;
  }

  dependencies(): EventingServerRuntimeDependencies {
    return {
      eventStore: this.eventStore,
      processStore: this.processStore,
      queueFactory: this.queueFactory,
      ...(this.retentionPolicyResolver
        ? { retentionPolicyResolver: this.retentionPolicyResolver }
        : {}),
    };
  }
}
