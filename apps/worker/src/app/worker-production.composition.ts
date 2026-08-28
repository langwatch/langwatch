import type { EventingServerRuntimeOptions } from "@langwatch/eventing/server";
import {
  EnterpriseWorkerComposition,
  type EnterpriseWorkerCompositionOptions,
} from "@langwatch/enterprise-worker";
import type { ProcessObservability } from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  TopicServerInstaller,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import { TopicWorkerFeatureInstaller } from "../features/topic/topic-worker-feature.installer";
import { TraceWorkerFeatureInstaller } from "../features/trace/trace-worker-feature.installer";
import type { WorkerConfig } from "../platform/config/worker.config";
import { WorkerEventingRuntime } from "../platform/eventing/worker-eventing.runtime";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../platform/lifecycle/worker-runtime.port";
import { WorkerRuntime } from "../platform/lifecycle/worker.runtime";
import { WorkerApplication } from "./worker.application";

/** The worker-owned runtime dependencies for the Topic feature. */
export type WorkerTopicCompositionOptions = {
  database: TopicServerInstallerDependencies["database"];
  redis: TopicServerInstallerDependencies["redis"];
  execution: TopicServerInstallerDependencies["execution"];
  metrics: TopicServerInstallerDependencies["metrics"];
};

/** Trace's package-owned processing registration, mounted before Topic. */
export type WorkerTraceCompositionOptions = {
  installer: TraceProcessingInstallerPort;
};

/** All process boundaries are supplied explicitly by the executable's boot root. */
export type WorkerProductionCompositionOptions = {
  config: WorkerConfig;
  eventing: EventingServerRuntimeOptions;
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  trace: WorkerTraceCompositionOptions;
  topic: WorkerTopicCompositionOptions;
  enterprise?: EnterpriseWorkerCompositionOptions;
  observability?: ProcessObservability;
  resources?: ResourceScope;
};

/**
 * Fully composed background-worker graph for extractable worker surfaces.
 *
 * It deliberately leaves the shared Eventing consumer disabled. A consumer
 * must register the complete Eventing job registry, including Trace's
 * `assignTopic` pipeline consumer, before it can safely claim
 * `event-sourcing/jobs`. The live legacy worker remains that registry today.
 */
export class WorkerProductionComposition {
  static create(options: WorkerProductionCompositionOptions): WorkerProductionComposition {
    const eventing = WorkerEventingRuntime.createProduction({
      persistence: options.eventing,
      warnWhenProjectionsRunInline: options.config.nodeEnvironment === "production",
    });
    const trace = TraceWorkerFeatureInstaller.create({
      installer: options.trace.installer,
      eventing,
    });
    const topicServer = TopicServerInstaller.create({
      database: options.topic.database,
      processStore: eventing.processStore,
      redis: options.topic.redis,
      execution: options.topic.execution,
      metrics: options.topic.metrics,
    });
    const topic = TopicWorkerFeatureInstaller.create({
      installer: topicServer,
      eventing,
      traceAssignments: trace.traceAssignments,
    });
    const enterprise = options.enterprise
      ? EnterpriseWorkerComposition.create(options.enterprise)
      : undefined;

    return WorkerProductionComposition.createFromPorts({
      config: options.config,
      eventing,
      lifecycle: options.lifecycle,
      transport: options.transport,
      topic,
      trace,
      enterprise,
      observability: options.observability,
      resources: options.resources,
    });
  }

  /**
   * Keeps ports testable and lets a host supply already-composed technical
   * resources without manufacturing in-memory production substitutes.
   */
  static createFromPorts(options: {
    config: WorkerConfig;
    eventing: WorkerEventingRuntime;
    lifecycle: WorkerLifecyclePort;
    transport: WorkerTransportPort;
    topic: TopicWorkerFeatureInstaller;
    trace: TraceWorkerFeatureInstaller;
    enterprise?: EnterpriseWorkerComposition | EnterpriseWorkerCompositionOptions;
    observability?: ProcessObservability;
    resources?: ResourceScope;
  }): WorkerProductionComposition {
    const lifecycle = WorkerProductionLifecycle.create(options.lifecycle);
    const runtime = WorkerRuntime.create({
      lifecycle,
      transport: options.transport,
      resources: options.resources,
    });
    const application = WorkerApplication.create({
      runtime,
      eventing: options.eventing,
      featureInstallers: [options.trace, options.topic],
    });

    options.observability?.logger.info(
      {
        environment: options.config.environment,
        features: [options.trace.name, options.topic.name],
      },
      "worker production graph composed",
    );

    const enterprise =
      options.enterprise instanceof EnterpriseWorkerComposition
        ? options.enterprise
        : options.enterprise
          ? EnterpriseWorkerComposition.create(options.enterprise)
          : undefined;

    return new WorkerProductionComposition(
      application,
      options.eventing,
      options.topic,
      options.trace,
      enterprise,
    );
  }

  private constructor(
    readonly application: WorkerApplication,
    readonly eventing: WorkerEventingRuntime,
    readonly topic: TopicWorkerFeatureInstaller,
    readonly trace: TraceWorkerFeatureInstaller,
    readonly enterprise: EnterpriseWorkerComposition | undefined,
  ) {}
}

class WorkerProductionLifecycle extends WorkerLifecyclePort {
  static create(lifecycle: WorkerLifecyclePort): WorkerProductionLifecycle {
    return new WorkerProductionLifecycle(lifecycle);
  }

  private constructor(private readonly lifecycle: WorkerLifecyclePort) {
    super();
  }

  async close(): Promise<void> {
    await this.lifecycle.close();
  }
}
