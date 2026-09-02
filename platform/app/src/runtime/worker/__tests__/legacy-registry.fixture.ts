/**
 * The live legacy registry, built for real against in-memory Eventing.
 *
 * Two suites need it and neither may fake it. The parity guard compares what it
 * registers against the packaged composition, and the composition-root suite
 * mounts its definitions through the production mapper — both are answering
 * "does the packaged consumer route what the legacy consumer routes", and a
 * hand-written stand-in would only ever answer "does it route what this file
 * says".
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { LogRuntimeAdapter } from "@langwatch/log-server";
import { MetricRuntimeAdapter } from "@langwatch/metric-server";
import { TopicServerInstaller } from "@langwatch/topic-server";
import { WorkerHandlePort, WorkerLifecyclePort, WorkerTransportPort } from "@langwatch/worker";
import { AuthzFeature } from "~/runtime/app/features/authz";
import type { WorkerEventingHandoff } from "~/server/app-layer/worker-eventing-handoff";
import {
  PipelineRegistry,
  type PipelineRegistryWorkerCapabilities,
} from "~/server/event-sourcing/registration/pipelineRegistry";

/**
 * A permissive stand-in for the ~77 collaborators `PipelineRegistry` takes:
 * every access yields something callable, constructible and chainable.
 *
 * It is enough because a pipeline DEFINITION is a static description — its
 * routing keys come from the command, projection, subscriber and process names
 * the feature package declares, never from the ports those handlers will later
 * call. Four collaborators are supplied for real below, because they carry the
 * definition itself rather than a port it uses.
 */
export function autoStub(): any {
  const stub = () => autoStub();
  return new Proxy(stub, {
    get: (_target, property) => {
      if (property === "then") return undefined; // never look thenable to `await`
      if (property === Symbol.toPrimitive) return () => "stub";
      return autoStub();
    },
    apply: () => autoStub(),
    construct: () => autoStub(),
  });
}

export type BuiltRegistry = {
  /** Pipeline names in mount order. */
  pipelines: string[];
  /** Every `${pipeline}:${jobType}:${jobName}` the shared queue can route. */
  routingKeys: string[];
};

export type LegacyBuild = BuiltRegistry & {
  /**
   * The registry's own production export seam, rather than what spies could
   * observe of its internals. Anything this cannot carry across is a gap in
   * the switch itself, not in the test.
   */
  capabilities: PipelineRegistryWorkerCapabilities;
  topicInstallerOptions: unknown;
};

/**
 * Builds the live legacy registry against in-memory Eventing stores.
 *
 * Four collaborators are real rather than stubbed, because each one IS a
 * pipeline definition (or the installer that produces one) rather than a port
 * a handler calls: Metric, Log, AuthZ and Topic. Stubbed, they register
 * unnamed pipelines and four of the twenty-six keys' namespaces vanish.
 */
export function buildLegacyRegistry(): LegacyBuild {
  const eventSourcing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    // Producer-only: these suites read the registry, they never claim the queue.
    consumersEnabled: false,
    executionTarget: "worker",
  });

  const redaction = autoStub();
  const topicInstallerOptions = {
    database: autoStub(),
    processStore: InMemoryProcessStore.createForTesting(),
    redis: null,
    execution: autoStub(),
    metrics: autoStub(),
  };

  const supplied: Record<string, unknown> = {
    eventSourcing,
    logProcessing: LogRuntimeAdapter.createUnavailable({
      defaultRetentionDays: 30,
      logCommandShardCount: 1,
      redaction,
    }),
    metricProcessing: MetricRuntimeAdapter.createUnavailable({
      defaultRetentionDays: 30,
      metricCommandShardCount: 1,
      redaction,
    }),
    authz: {
      pipeline: AuthzFeature.create({
        database: autoStub(),
        redis: autoStub(),
        newBindingId: () => "binding",
        cacheEnabled: () => false,
      } as never).pipeline,
      connect: () => void 0,
    },
    topicClustering: { installer: TopicServerInstaller.create(topicInstallerOptions as never) },
    enterprisePipelines: autoStub(),
  };

  const registry = new PipelineRegistry(
    new Proxy(supplied, {
      get: (target, property) =>
        property in target ? (target as Record<string | symbol, unknown>)[property] : autoStub(),
    }) as never,
  );
  registry.registerAll();

  return {
    pipelines: eventSourcing.definitions.map((definition) => definition.metadata.name),
    routingKeys: [...eventSourcing.globalJobRegistry.keys()].sort(),
    capabilities: registry.exportWorkerCapabilities(),
    topicInstallerOptions,
  };
}

/**
 * The handoff a worker-role App exposes, as far as the capability mapper reads
 * it: the registry's export seam, the Topic installer's dependencies, and the
 * one `isSaas` both graphs' global projections derive from.
 *
 * `substrate` is stubbed rather than built, because the capability mapper never
 * touches it — the substrate feeds `packagedWorkerEventing`, and a suite that
 * wants one supplies its own.
 */
export function packagedHandoff(
  legacy: LegacyBuild,
  overrides?: Partial<WorkerEventingHandoff>,
): WorkerEventingHandoff {
  return {
    appOwnsEventingConsumers: false,
    isSaas: true,
    capabilities: legacy.capabilities,
    substrate: autoStub(),
    topic: legacy.topicInstallerOptions as never,
    ...overrides,
  };
}

export class NoopLifecycle extends WorkerLifecyclePort {
  async close(): Promise<void> {}
}

export class NoopHandle extends WorkerHandlePort {
  async shutdown(): Promise<void> {}
}

export class NoopTransport extends WorkerTransportPort {
  async start(): Promise<WorkerHandlePort> {
    return new NoopHandle();
  }
}

/** The process-manager persistence surface, answering without a database. */
export function processPersistenceDatabase() {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async <Result>(run: (transaction: object) => Promise<Result>) => run({}),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  };
}
