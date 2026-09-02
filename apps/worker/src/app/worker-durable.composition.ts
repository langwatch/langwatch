import {
  createEventingRetentionConfiguration,
  type EventingClickHouseClientResolver,
  type EventingProcessPersistenceDatabase,
} from "@langwatch/eventing/server";
import type { RetentionPolicyResolver } from "@langwatch/eventing";
import type { ProcessObservability } from "@langwatch/observability/node";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { EnterpriseWorkerCompositionOptions } from "@langwatch/enterprise-worker";
import type { WorkerConfig } from "../platform/config/worker.config";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../platform/lifecycle/worker-runtime.port";
import {
  createWorkerPrivateInfrastructureComposition,
  type WorkerPrivateInfrastructurePorts,
} from "./worker-private-infrastructure.composition";
import {
  WorkerProductionComposition,
  type WorkerTopicCompositionOptions,
} from "./worker-production.composition";

/**
 * The two persistence engines the durable Eventing graph is built on.
 *
 * Both arrive as ports rather than as configuration the worker reads. The
 * process-store side is the deployment's Prisma client, handed over opaquely
 * so generated Prisma stays out of this package's declarations; the event
 * store side is a tenant-aware ClickHouse resolver, because routing a tenant
 * to its instance is the host's decision and Eventing must never make it.
 */
export type WorkerDurablePersistencePorts = Readonly<{
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
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  persistence: WorkerDurablePersistencePorts;
  /** Project BYOC and Azure capabilities for the Group Queue's blob offload. */
  storage: WorkerPrivateInfrastructurePorts;
  topic: WorkerTopicCompositionOptions;
  enterprise?: EnterpriseWorkerCompositionOptions;
  observability?: ProcessObservability;
}>;

/**
 * The production caller for the Worker's durable graph.
 *
 * It is the single place where the private infrastructure projection (Redis,
 * Group Queue policy, outbound proxy, stored-object storage) meets the durable
 * Eventing persistence (the ClickHouse event store and the Prisma process
 * store), so a deployment has exactly one composition to supply ports to
 * rather than two that could disagree about which Redis or which retention
 * they are using.
 *
 * Consumers stay disabled. This composition asks for none, and it may not:
 * `event-sourcing/jobs` is one shared queue holding every pipeline, so a
 * worker that claimed it while any pipeline were still unmounted would reject
 * and redeliver that pipeline's jobs indefinitely. The graph it builds mounts
 * only the features its caller supplies, which is never all of them yet.
 * Claiming the queue belongs to the composition that completes the registry.
 */
export function createWorkerDurableComposition(
  options: WorkerDurableCompositionOptions,
): WorkerProductionComposition {
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
    },
    topic: options.topic,
    ...(options.enterprise ? { enterprise: options.enterprise } : {}),
    ...(options.observability ? { observability: options.observability } : {}),
  });
}
