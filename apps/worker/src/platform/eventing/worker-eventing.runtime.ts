import {
  EventSourcing,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  type EventStore,
  type ExecutionTarget,
  type ProcessStore,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";

export interface WorkerEventingDependencies {
  eventStore: EventStore;
  queueFactory(
    definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>>;
  processStore: ProcessStore;
  executionTarget: ExecutionTarget;
  /** Production-only diagnostic for missing shared projection queues. */
  warnWhenProjectionsRunInline: boolean;
  /**
   * Kept as an explicit false-only assertion until the complete shared queue
   * registry moves into a dedicated consumer-capable composition.
   */
  consumersEnabled?: false;
  retentionPolicyResolver?: RetentionPolicyResolver;
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

  readonly eventSourcing: EventSourcing;
  private registrationsComplete = false;
  private started = false;
  private startPromise: Promise<void> | undefined;
  private closed = false;

  private constructor(dependencies: WorkerEventingDependencies) {
    this.eventSourcing = new EventSourcing({
      enabled: true,
      eventStore: dependencies.eventStore,
      queueFactory: dependencies.queueFactory,
      consumersEnabled: false,
      executionTarget: dependencies.executionTarget,
      processStore: dependencies.processStore,
      retentionPolicyResolver: dependencies.retentionPolicyResolver,
      warnWhenProjectionsRunInline: dependencies.warnWhenProjectionsRunInline,
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
