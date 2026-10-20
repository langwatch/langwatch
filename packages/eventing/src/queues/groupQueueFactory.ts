import { randomUUID } from "node:crypto";

import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueError,
  GroupQueueProducer,
  HandBackGroupQueueError,
  NonRetryableGroupQueueError,
  type GroupQueueDependencies,
  type RunningGroupQueueConsumer,
} from "@langwatch/group-queue";
import { createLogger, type Logger } from "@langwatch/observability";

import { incrementEsJobsProjectGone } from "../metrics.ts";
import {
  classifyClickHouseError,
  ErrorCategory,
  isProjectGone,
  UndeclaredQueuedEventTypeError,
  UnroutableQueuedJobError,
} from "../services/errorHandling.ts";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  JobDelivery,
} from "./queue.types.ts";

const logger = createLogger("langwatch:event-sourcing:group-queue");

export interface EventingGroupQueueFactoryOptions {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  consumersEnabled?: boolean;
  /** A second consumer runs only the groups on lists `runListedWork` opens, ahead of the rest. */
  listedConsumer?: boolean;
}

/** A schema refusal is deterministic: retrying the same value would only fail 25 times. */
export async function refuseInvalidValueOnce<T>({
  queueName,
  run,
}: {
  queueName: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof Error && "issues" in error && Array.isArray(error.issues))) throw error;
    throw new NonRetryableGroupQueueError(
      `Queue ${queueName} refused a value that fails its schema: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * A job this worker has no handler for, or whose event type it does not declare, goes back to
 * the queue without using an attempt (Alex, 2026-10-12).
 */
export async function handBackUnroutable<T>({ run }: { run: () => Promise<T> }): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const unhandled =
      error instanceof UnroutableQueuedJobError || error instanceof UndeclaredQueuedEventTypeError;
    if (!unhandled) throw error;
    throw new HandBackGroupQueueError(error.message, { cause: error });
  }
}

/**
 * A job whose project was deleted after it was queued can never succeed, whatever its kind
 * (command, fold, map, subscriber, process manager): it completes as a logged no-op instead of
 * retrying into a blocked group (specs/eventing/deleted-project-jobs.feature).
 */
export async function completeWhenProjectGone({
  queueName,
  payloads,
  run,
  log = logger,
}: {
  queueName: string;
  payloads: readonly Record<string, unknown>[];
  run: () => Promise<void>;
  log?: Logger;
}): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isProjectGone(error)) throw error;
    const first = payloads[0];
    incrementEsJobsProjectGone({
      queue: queueName,
      jobType: typeof first?.__jobType === "string" ? first.__jobType : "unknown",
      count: payloads.length,
    });
    log.warn(
      {
        tenantId: first?.tenantId ?? null,
        queueName,
        jobType: first?.__jobType ?? null,
        jobName: first?.__jobName ?? null,
        jobs: payloads.length,
      },
      "Job's project no longer exists; completing it as a no-op",
    );
  }
}

/** The first error in a cause chain that ClickHouse's own classification calls transient. */
function overloadedClickHouseError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (classifyClickHouseError(current) === ErrorCategory.RECOVERABLE) return current;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/**
 * An overloaded ClickHouse fails a smaller batch just the same, so the batch
 * names a retry delay: the queue backs it off whole on its own exponential
 * schedule instead of splitting it (packages/group-queue/specs/batch-bisection.feature).
 */
export async function backOffWhenOverloaded<T>({
  queueName,
  run,
}: {
  queueName: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const overloaded = overloadedClickHouseError(error);
    if (overloaded === undefined) throw error;
    const code =
      overloaded !== null && typeof overloaded === "object" && "code" in overloaded
        ? String(overloaded.code)
        : "unknown";
    throw new GroupQueueError({
      queueName,
      operation: "processBatch",
      message: `ClickHouse overloaded (code ${code}); backing the batch off whole: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
      retryAfterMs: 0,
    });
  }
}

/** The queue's own consumer, and one that runs only listed groups when asked for. */
function consumerDependencies({
  dependencies,
  listedConsumer,
}: {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  listedConsumer: boolean;
}): GroupQueueDependencies<Record<string, unknown>>[] {
  if (!listedConsumer) return [dependencies];
  return [dependencies, { ...dependencies, dispatchListed: true }];
}

/**
 * Adapts the capability-split Group Queue API to Eventing's shared runtime
 * queue port. Application composition owns the Redis and storage dependencies;
 * Eventing owns only the routing definition and handler registry.
 */
export function createEventingGroupQueueFactory({
  dependencies,
  consumersEnabled = true,
  listedConsumer = false,
}: EventingGroupQueueFactoryOptions): (
  definition: EventSourcedQueueDefinition<Record<string, unknown>>,
) => EventSourcedQueueProcessor<Record<string, unknown>> {
  return (eventingDefinition) => {
    const queueDefinition = defineGroupQueue({
      name: eventingDefinition.name,
      payload: {
        parse(value): Record<string, unknown> {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Eventing queue payload must be an object");
          }
          return value as Record<string, unknown>;
        },
      },
      groupBy: (payload) => eventingDefinition.groupKey?.(payload) ?? randomUUID(),
      identify: () => randomUUID(),
      score: eventingDefinition.score,
      spanAttributes: eventingDefinition.spanAttributes,
      delay: eventingDefinition.delay,
      deduplication: eventingDefinition.deduplication,
      coalescing: eventingDefinition.processBatch
        ? {
            maxItems: eventingDefinition.coalesceMaxBatch ?? (() => 1),
            maxBytes: eventingDefinition.coalesceMaxBytes,
          }
        : undefined,
      onExhausted: eventingDefinition.onExhausted,
    });

    const refuse = <T>(run: () => Promise<T>) =>
      handBackUnroutable({
        run: () => refuseInvalidValueOnce({ queueName: eventingDefinition.name, run }),
      });
    const producer = new GroupQueueProducer(queueDefinition, dependencies);
    let consumers: RunningGroupQueueConsumer<Record<string, unknown>>[] = [];
    // Claiming starts on `start()`, never at construction: a job claimed before
    // every pipeline registered its handler has nowhere to go.
    const startConsuming = (
      consumerDependencies: GroupQueueDependencies<Record<string, unknown>>,
    ): RunningGroupQueueConsumer<Record<string, unknown>> => {
      const configuredConsumer = new GroupQueueConsumer(queueDefinition, consumerDependencies);
      const one = (payload: Record<string, unknown>, context: JobDelivery | undefined) =>
        refuse(() =>
          completeWhenProjectGone({
            queueName: eventingDefinition.name,
            payloads: [payload],
            run: () => eventingDefinition.process(payload, context),
          }),
        );
      return eventingDefinition.processBatch
        ? configuredConsumer.handleBatch({
            each: one,
            batch: (payloads, context) =>
              backOffWhenOverloaded({
                queueName: eventingDefinition.name,
                run: () =>
                  refuse(() =>
                    completeWhenProjectGone({
                      queueName: eventingDefinition.name,
                      payloads,
                      run: () => eventingDefinition.processBatch!(payloads, context),
                    }),
                  ),
              }),
          })
        : configuredConsumer.handle(one);
    };

    return {
      send: (payload, options) => producer.send(payload, options),
      sendBatch: (payloads, options) => producer.sendBatch(payloads, options),
      sendEach: (payloads, options) => producer.sendEach(payloads, options),
      runListedWork: (input) => producer.runListedWork(input),
      start() {
        if (!consumersEnabled || consumers.length > 0) return;
        consumers = consumerDependencies({ dependencies, listedConsumer }).map(startConsuming);
      },
      pause: () => consumers.forEach((each) => each.pause()),
      resume: () => consumers.forEach((each) => each.resume()),
      async waitUntilReady() {
        await Promise.all([
          producer.waitUntilReady(),
          ...consumers.map((each) => each.waitUntilReady()),
        ]);
      },
      // Consumers first: a job still draining sends its fan-out through THIS producer, and a
      // producer's gate shuts the moment its own close ends, which for a processor with nothing
      // in flight is at once. Spec: specs/background/queue-drain-send-gate.feature
      // Every consumer settles first, even when one fails, so a failure never shuts the gate early.
      async close() {
        try {
          const drained = await Promise.allSettled(consumers.map((each) => each.close()));
          const failed = drained.find(
            (each): each is PromiseRejectedResult => each.status === "rejected",
          );
          if (failed) throw failed.reason;
        } finally {
          await producer.close();
        }
      },
    };
  };
}
