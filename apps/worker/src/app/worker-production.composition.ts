import {
  EventingServerRuntime,
  type EventingServerRuntimeOptions,
} from "@langwatch/eventing/server";
import {
  EnterpriseWorkerComposition,
  type EnterpriseWorkerCompositionOptions,
} from "@langwatch/enterprise-worker";
import type { ProcessObservability } from "@langwatch/observability/node";
import {
  TopicServerInstaller,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import type { TraceTopicAssignmentPort } from "@langwatch/trace-contract";
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
  traceAssignments: TraceTopicAssignmentPort;
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
  trace?: WorkerTraceCompositionOptions;
  topic: WorkerTopicCompositionOptions;
  enterprise?: EnterpriseWorkerCompositionOptions;
  observability?: ProcessObservability;
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
    const eventingServer = EventingServerRuntime.create({
      ...options.eventing,
      consumersEnabled: false,
    });
    const eventing = WorkerEventingRuntime.create({
      ...eventingServer.dependencies(),
      executionTarget: "worker",
      consumersEnabled: false,
    });
    const topicServer = TopicServerInstaller.create({
      database: options.topic.database,
      processStore: eventingServer.processStore,
      redis: options.topic.redis,
      execution: options.topic.execution,
      metrics: options.topic.metrics,
    });
    const trace = options.trace
      ? TraceWorkerFeatureInstaller.create({
          installer: options.trace.installer,
          eventing,
        })
      : undefined;
    const topic = TopicWorkerFeatureInstaller.create({
      installer: topicServer,
      eventing,
      traceAssignments: trace?.traceAssignments ?? options.topic.traceAssignments,
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
    trace?: TraceWorkerFeatureInstaller;
    enterprise?: EnterpriseWorkerComposition | EnterpriseWorkerCompositionOptions;
    observability?: ProcessObservability;
  }): WorkerProductionComposition {
    const lifecycle = WorkerProductionLifecycle.create({
      lifecycle: options.lifecycle,
      observability: options.observability,
    });
    const runtime = WorkerRuntime.create({ lifecycle, transport: options.transport });
    const application = WorkerApplication.create({
      runtime,
      eventing: options.eventing,
      featureInstallers: options.trace ? [options.trace, options.topic] : [options.topic],
    });

    options.observability?.logger.info(
      {
        environment: options.config.environment,
        features: options.trace ? [options.trace.name, options.topic.name] : [options.topic.name],
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
    readonly trace: TraceWorkerFeatureInstaller | undefined,
    readonly enterprise: EnterpriseWorkerComposition | undefined,
  ) {}
}

class WorkerProductionLifecycle extends WorkerLifecyclePort {
  static create(options: {
    lifecycle: WorkerLifecyclePort;
    observability?: ProcessObservability;
  }): WorkerProductionLifecycle {
    return new WorkerProductionLifecycle(options.lifecycle, options.observability);
  }

  private constructor(
    private readonly lifecycle: WorkerLifecyclePort,
    private readonly observability: ProcessObservability | undefined,
  ) {
    super();
  }

  async close(): Promise<void> {
    let firstError: unknown;
    try {
      await this.lifecycle.close();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.observability?.shutdown();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }
}
