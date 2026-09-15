import {
  createEventingRetentionConfiguration,
  type EventingClickHouseClientResolver,
  type EventingProcessPersistenceDatabase,
} from "@langwatch/eventing/server";
import { classifyEventLogRowRetention } from "@langwatch/data-retention-contract";
import type { RetentionPolicyResolver } from "@langwatch/eventing";
import type { ProcessObservability } from "@langwatch/observability/node";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { EnterpriseWorkerCompositionOptions } from "@langwatch/enterprise-worker";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import {
  WorkerLifecycle,
  WorkerTransport,
} from "../platform/lifecycle/worker-runtime.port.ts";
import {
  createWorkerPrivateInfrastructureComposition,
  type WorkerPrivateInfrastructureMembers,
} from "./worker-private-infrastructure.composition.ts";
import {
  WorkerProductionComposition,
  type WorkerDatabaseCompositionOptions,
} from "./worker-production.composition.ts";

// Process store (Prisma) and event store (ClickHouse) persistence for the
// durable Eventing graph; both arrive as ports, not configuration
export type WorkerDurablePersistenceMembers = Readonly<{
  database: EventingProcessPersistenceDatabase;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The fallback for event rows whose tenant declares no override. */
  defaultRetentionDays: number;
  /** The per-tenant override, where the deployment resolves one. */
  retentionPolicyResolver?: RetentionPolicyResolver;
}>;

export type WorkerDurableCompositionOptions = Readonly<{
  config: WorkerConfig;
  /** Owns every client this composition constructs, released on shutdown. */
  resources: ResourceScope;
  lifecycle: WorkerLifecycle;
  transport: WorkerTransport;
  persistence: WorkerDurablePersistenceMembers;
  /** Project BYOC and Azure capabilities for the Group Queue's blob offload. */
  storage: WorkerPrivateInfrastructureMembers;
  /** The one Prisma client this process opened. */
  database: WorkerDatabaseCompositionOptions;
  enterprise?: EnterpriseWorkerCompositionOptions;
  observability?: ProcessObservability;
}>;

// Unifies infrastructure projection and durable Eventing persistence so
// deployments don't disagree about Redis or retention; consumers disabled here
export function createWorkerDurableComposition(
  options: WorkerDurableCompositionOptions,
): Promise<WorkerProductionComposition> {
  const infrastructure = createWorkerPrivateInfrastructureComposition({
    config: options.config,
    ports: options.storage,
  });

  return WorkerProductionComposition.create({
    config: options.config,
    lifecycle: options.lifecycle,
    transport: options.transport,
    resources: options.resources,
    infrastructure,
    eventing: {
      database: options.persistence.database,
      resolveClickHouseClient: options.persistence.resolveClickHouseClient,
      retention: createEventingRetentionConfiguration({
        defaultRetentionDays: options.persistence.defaultRetentionDays,
      }),
      ...(options.persistence.retentionPolicyResolver
        ? { retentionPolicyResolver: options.persistence.retentionPolicyResolver }
        : {}),
      // Security aggregates keep their history whatever the tenant's trace
      // retention says — the classifier names them row by row.
      classifyEventLogRetention: classifyEventLogRowRetention,
    },
    database: options.database,
    ...(options.enterprise ? { enterprise: options.enterprise } : {}),
    ...(options.observability ? { observability: options.observability } : {}),
  });
}
