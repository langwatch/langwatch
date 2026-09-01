import {
  EventSourcing,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  type EventSourcingOptions,
  type EventStore,
  type ExecutionTarget,
  type ProcessStore,
  type ReplayMarkerChecker,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";
import {
  EventingServerRuntime,
  type EventingServerRuntimeOptions,
} from "@langwatch/eventing/server";

/**
 * Whether this runtime claims `event-sourcing/jobs`, and what claiming it needs
 * beyond the producer surface.
 *
 * Absent means disabled. Exactly one process may consume the shared queue, so
 * the composition that owns the consumer has to say so; every other
 * construction stays a producer by omission rather than by remembering to opt
 * out.
 */
export type WorkerEventingConsumerOptions =
  | {
      enabled: true;
      /**
       * Consulted per event before a projection applies it, so it only ever
       * runs where the jobs are processed. A consumer without one applies
       * events a projection replay is mid-way through re-deriving, and the two
       * writers race for the same aggregate.
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
  /**
   * Projections that span pipelines, configured before any of them exist.
   *
   * The Eventing runtime takes these at construction because a global
   * projection's queues are registered against the shared job registry the
   * moment the first pipeline is registered, not by an installer afterwards.
   * The live registry configures the SaaS billable-events meter and its
   * dispatch subscriber exactly here, and their routing keys (`global:*`) sit
   * in the same registry as every pipeline's. A consumer that claimed
   * `event-sourcing/jobs` without them would reject and redeliver every
   * billable span, evaluation, experiment and simulation event forever.
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
   * Builds the Worker’s one durable Eventing graph from the sealed server
   * adapters. The process root supplies Prisma, ClickHouse, retention, and
   * Group Queue ports, and says whether this process is the one that consumes
   * the shared queue — a runtime built without that option produces only.
   *
   * The decision reaches two places from here. The Group Queue factory decides
   * whether a queue definition also starts a consumer loop, and the Eventing
   * runtime decides whether the process-manager outbox, wake and schedule
   * workers run. Half of that is a graph that claims jobs and never drains its
   * own process managers.
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
