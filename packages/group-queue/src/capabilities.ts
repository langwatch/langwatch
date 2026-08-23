import type {
  GroupQueueDefinition,
  GroupQueueDependencies,
  GroupQueueHandlerContext,
  GroupQueueRuntimeDefinition,
  JobDelivery,
  QueueSendOptions,
} from "./contracts";
import { GroupQueueProcessor } from "./groupQueue";

function assertRuleResult(rule: "groupBy" | "identify", value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Group Queue ${rule}(payload) must return a non-empty string`,
    );
  }
  return value;
}

function validateDependencies<Payload extends Record<string, unknown>>(
  dependencies: GroupQueueDependencies<Payload>,
): void {
  const concurrency = dependencies.policy?.globalConcurrency;
  if (
    concurrency !== undefined &&
    (!Number.isSafeInteger(concurrency) || concurrency <= 0)
  ) {
    throw new Error("Group Queue globalConcurrency must be a positive integer");
  }
  const drainTimeoutMs = dependencies.policy?.drainTimeoutMs;
  if (
    drainTimeoutMs !== undefined &&
    (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs <= 0)
  ) {
    throw new Error("Group Queue drainTimeoutMs must be a positive number");
  }
  for (const [name, value] of Object.entries({
    tenantConcurrencyCap: dependencies.policy?.tenantConcurrencyCap,
    globalConcurrencyBudget: dependencies.policy?.globalConcurrencyBudget,
    confirmedDeathThreshold: dependencies.policy?.confirmedDeathThreshold,
    quarantineFailureThreshold: dependencies.policy?.quarantineFailureThreshold,
    bisectionSplitBudget: dependencies.policy?.bisectionSplitBudget,
  })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Group Queue ${name} must be a non-negative integer`);
    }
  }
}

function runtimeDefinition<Payload extends Record<string, unknown>>({
  definition,
  process,
  processBatch,
  dependencies,
}: {
  definition: GroupQueueDefinition<Payload>;
  process: GroupQueueRuntimeDefinition<Payload>["process"];
  processBatch?: GroupQueueRuntimeDefinition<Payload>["processBatch"];
  dependencies: GroupQueueDependencies<Payload>;
}): GroupQueueRuntimeDefinition<Payload> {
  return {
    name: definition.transportName,
    process,
    processBatch,
    groupKey: (payload) =>
      assertRuleResult("groupBy", definition.groupBy(payload)),
    identify: (payload) =>
      assertRuleResult("identify", definition.identify(payload)),
    score: definition.score,
    spanAttributes: definition.spanAttributes,
    delay: definition.delay,
    deduplication: definition.deduplication,
    coalesceMaxBatch: definition.coalescing?.maxItems,
    coalesceMaxBytes: definition.coalescing?.maxBytes,
    options: { globalConcurrency: dependencies.policy?.globalConcurrency },
  };
}

function processorOptions<Payload extends Record<string, unknown>>(
  dependencies: GroupQueueDependencies<Payload>,
  consumerEnabled: boolean,
) {
  return {
    consumerEnabled,
    objectStoreFor: dependencies.objectStoreFor,
    resolveStorageDestination: dependencies.resolveStorageDestination,
    activity: dependencies.activity,
    context: dependencies.context,
    failures: dependencies.failures,
    drainTimeoutMs: dependencies.policy?.drainTimeoutMs,
    policy: dependencies.policy,
  };
}

export class GroupQueueProducer<Payload extends Record<string, unknown>> {
  readonly definition: GroupQueueDefinition<Payload>;
  readonly #processor: GroupQueueProcessor<Payload>;

  constructor(
    definition: GroupQueueDefinition<Payload>,
    dependencies: GroupQueueDependencies<Payload>,
  ) {
    validateDependencies(dependencies);
    this.definition = definition;
    this.#processor = new GroupQueueProcessor(
      runtimeDefinition({
        definition,
        dependencies,
        process: async () => {
          throw new Error("A producer cannot execute queue work");
        },
      }),
      dependencies.redis,
      processorOptions(dependencies, false),
    );
  }

  async send(
    payload: Payload,
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    await this.#processor.send(this.definition.payload.parse(payload), options);
  }

  async sendBatch(
    payloads: readonly Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    const decoded = payloads.map((payload) =>
      this.definition.payload.parse(payload),
    );
    await this.#processor.sendBatch(decoded, options);
  }

  waitUntilReady(): Promise<void> {
    return this.#processor.waitUntilReady();
  }

  close(): Promise<void> {
    return this.#processor.close();
  }
}

export class GroupQueueConsumer<Payload extends Record<string, unknown>> {
  readonly definition: GroupQueueDefinition<Payload>;
  readonly #dependencies: GroupQueueDependencies<Payload>;

  constructor(
    definition: GroupQueueDefinition<Payload>,
    dependencies: GroupQueueDependencies<Payload>,
  ) {
    validateDependencies(dependencies);
    this.definition = definition;
    this.#dependencies = dependencies;
  }

  handle(
    handler: (
      payload: Payload,
      context: GroupQueueHandlerContext,
    ) => Promise<void>,
  ): RunningGroupQueueConsumer<Payload> {
    return this.start({ each: handler });
  }

  handleBatch(options: {
    each: (
      payload: Payload,
      context: GroupQueueHandlerContext,
    ) => Promise<void>;
    batch: (
      payloads: Payload[],
      context: GroupQueueHandlerContext,
    ) => Promise<void>;
  }): RunningGroupQueueConsumer<Payload> {
    if (!this.definition.coalescing) {
      throw new Error(
        `Group Queue "${this.definition.name}" must define coalescing before registering a batch handler`,
      );
    }
    return this.start(options);
  }

  private start(handlers: {
    each: (
      payload: Payload,
      context: GroupQueueHandlerContext,
    ) => Promise<void>;
    batch?: (
      payloads: Payload[],
      context: GroupQueueHandlerContext,
    ) => Promise<void>;
  }): RunningGroupQueueConsumer<Payload> {
    const abort = new AbortController();
    const context = (delivery?: JobDelivery): GroupQueueHandlerContext => ({
      attempt: delivery?.attempt ?? 1,
      isContinuation: delivery?.isContinuation,
      signal: abort.signal,
    });
    const processor = new GroupQueueProcessor(
      runtimeDefinition({
        definition: this.definition,
        dependencies: this.#dependencies,
        process: async (payload, delivery) => {
          const decoded = this.definition.payload.parse(payload);
          await handlers.each(decoded, context(delivery));
        },
        processBatch: handlers.batch
          ? async (payloads, delivery) => {
              const decoded = payloads.map((payload) =>
                this.definition.payload.parse(payload),
              );
              await handlers.batch!(decoded, context(delivery));
            }
          : undefined,
      }),
      this.#dependencies.redis,
      processorOptions(this.#dependencies, true),
    );
    return new RunningGroupQueueConsumer(processor, abort);
  }
}

export class RunningGroupQueueConsumer<
  Payload extends Record<string, unknown>,
> {
  readonly #processor: GroupQueueProcessor<Payload>;
  readonly #abort: AbortController;

  constructor(processor: GroupQueueProcessor<Payload>, abort: AbortController) {
    this.#processor = processor;
    this.#abort = abort;
  }

  waitUntilReady(): Promise<void> {
    return this.#processor.waitUntilReady();
  }

  setConcurrency(value: number): void {
    this.#processor.setConcurrency(value);
  }

  async close(): Promise<void> {
    try {
      await this.#processor.close();
    } catch (error) {
      this.#abort.abort();
      throw error;
    }
  }
}
