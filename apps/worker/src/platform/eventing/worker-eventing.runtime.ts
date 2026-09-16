import {
  EventSourcing,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  type EventSourcingOptions,
  type EventStore,
  type ExecutionTarget,
  type KillSwitch,
  type ProcessStore,
  type ReplayMarkerChecker,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";
import {
  EventingServerRuntime,
  type EventingServerRuntimeOptions,
} from "@langwatch/eventing/server";

/**
 * Whether this runtime claims `event-sourcing/jobs` — only one process consumes the shared
 * queue.
 */
export type WorkerEventingConsumerOptions =
  | {
      enabled: true;
      /**
       * Consulted per event before a projection applies it, so it only runs
       * where jobs are processed. Without one, a consumer applies events a
       * replay is mid-way re-deriving, and both writers race the aggregate.
       */
      replayMarkerChecker?: ReplayMarkerChecker;
    }
  | { enabled: false };

export interface WorkerEventingDependencies {
  eventStore: EventStore;
  queueFactory(
    definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>>;
  processStore: ProcessStore;
  executionTarget: ExecutionTarget;
  /** Production-only diagnostic for missing shared projection queues. */
  warnWhenProjectionsRunInline: boolean;
  /** Consumer ownership for this runtime. Absent leaves it producer-only. */
  consumers?: WorkerEventingConsumerOptions;
  retentionPolicyResolver?: RetentionPolicyResolver;
  /** Per-tenant operator stop for every component the pipelines mount. */
  killSwitch?: KillSwitch;
  /**
   * Global projections must be configured at construction time, before the first pipeline is
   * registered, so their queues land in the shared job registry.
   */
  configureGlobalProjections?: EventSourcingOptions["configureGlobalProjections"];
}

/** Durable Eventing ports supplied by the Worker process composition root. */
export interface WorkerEventingProductionOptions {
  persistence: EventingServerRuntimeOptions;
  /** Production-only diagnostic for projections without a shared queue. */
  warnWhenProjectionsRunInline: boolean;
  /** Cross-pipeline projections, registered before the first pipeline. */
  configureGlobalProjections?: EventSourcingOptions["configureGlobalProjections"];
  /** Consumer ownership for this runtime. Absent leaves it producer-only. */
  consumers?: WorkerEventingConsumerOptions;
  /** Per-tenant operator stop for every component the pipelines mount. */
  killSwitch?: KillSwitch;
}

/**
 * The worker's one Eventing runtime. Feature installers receive this shared
 * instance to register command queues, projections, deterministic processes,
 * wakes, and retry-safe intent executors.
 */
export class WorkerEventingRuntime {
  static create(dependencies: WorkerEventingDependencies): WorkerEventingRuntime {
    return new WorkerEventingRuntime(dependencies);
  }

  /**
   * Builds the Eventing graph; consumer ownership determines whether queue definitions start
   * loops and whether process-manager workers run.
   */
  static createProduction(options: WorkerEventingProductionOptions): WorkerEventingRuntime {
    const consumers = options.consumers ?? { enabled: false };
    const server = EventingServerRuntime.create({
      ...options.persistence,
      consumersEnabled: consumers.enabled,
    });
    return WorkerEventingRuntime.create({
      ...server.dependencies(),
      executionTarget: "worker",
      consumers,
      killSwitch: options.killSwitch,
      warnWhenProjectionsRunInline: options.warnWhenProjectionsRunInline,
      ...(options.configureGlobalProjections
        ? { configureGlobalProjections: options.configureGlobalProjections }
        : {}),
    });
  }

  readonly eventSourcing: EventSourcing;
  readonly eventStore: EventStore;
  readonly processStore: ProcessStore;
  private registrationsComplete = false;
  private started = false;
  private startPromise: Promise<void> | undefined;
  private closed = false;

  private constructor(dependencies: WorkerEventingDependencies) {
    this.eventStore = dependencies.eventStore;
    this.processStore = dependencies.processStore;
    const consumers = dependencies.consumers ?? { enabled: false };
    this.eventSourcing = new EventSourcing({
      enabled: true,
      eventStore: this.eventStore,
      queueFactory: dependencies.queueFactory,
      consumersEnabled: consumers.enabled,
      executionTarget: dependencies.executionTarget,
      processStore: this.processStore,
      retentionPolicyResolver: dependencies.retentionPolicyResolver,
      killSwitch: dependencies.killSwitch,
      warnWhenProjectionsRunInline: dependencies.warnWhenProjectionsRunInline,
      configureGlobalProjections: dependencies.configureGlobalProjections,
      // Spread rather than assigned, so a producer-only runtime hands Eventing
      // the same option keys it did before this seam existed.
      ...(consumers.enabled && consumers.replayMarkerChecker
        ? { replayMarkerChecker: consumers.replayMarkerChecker }
        : {}),
    });
  }

  /**
   * Seals the producer registry after every worker feature has installed its
   * pipelines, process managers, outbox handlers, and wakes. Queue readiness
   * is intentionally unavailable before this point.
   */
  completeRegistrations(): void {
    if (this.closed) throw new Error("Worker Eventing runtime is closed.");
    this.registrationsComplete = true;
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Worker Eventing runtime is closed."));
    if (this.started) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    if (!this.registrationsComplete) {
      return Promise.reject(
        new Error("Worker Eventing registrations must complete before queue readiness is awaited."),
      );
    }

    const startPromise = Promise.resolve().then(async () => {
      await this.eventSourcing.globalQueue?.waitUntilReady();
      this.started = true;
    });
    this.startPromise = startPromise;
    void startPromise.then(
      () => this.clearStartPromise(startPromise),
      () => this.clearStartPromise(startPromise),
    );

    return startPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.eventSourcing.close();
  }

  private clearStartPromise(startPromise: Promise<void>): void {
    if (this.startPromise === startPromise) this.startPromise = void 0;
  }
}
