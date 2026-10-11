import { randomUUID } from "node:crypto";

import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueError,
  GroupQueueProducer,
  NonRetryableGroupQueueError,
  type GroupQueueDependencies,
  type RunningGroupQueueConsumer,
} from "@langwatch/group-queue";

import { classifyClickHouseError, ErrorCategory } from "../services/errorHandling.ts";
import type { EventSourcedQueueDefinition, EventSourcedQueueProcessor } from "./queue.types.ts";

export interface EventingGroupQueueFactoryOptions {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  consumersEnabled?: boolean;
  /** A second consumer runs only the groups listed under this key, ahead of any backlog. */
  allowListKeyFor?: (queueName: string) => string;
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

/** The queue's own consumer, and one that runs only listed groups when a key names them. */
function consumerDependencies({
  dependencies,
  listedKey,
}: {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  listedKey: string | undefined;
}): GroupQueueDependencies<Record<string, unknown>>[] {
  if (listedKey === undefined) return [dependencies];
  return [dependencies, { ...dependencies, dispatchGroupAllowListKey: listedKey }];
}

/**
 * Adapts the capability-split Group Queue API to Eventing's shared runtime
 * queue port. Application composition owns the Redis and storage dependencies;
 * Eventing owns only the routing definition and handler registry.
 */
export function createEventingGroupQueueFactory({
  dependencies,
  consumersEnabled = true,
  allowListKeyFor,
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
      refuseInvalidValueOnce({ queueName: eventingDefinition.name, run });
    const producer = new GroupQueueProducer(queueDefinition, dependencies);
    let consumers: RunningGroupQueueConsumer<Record<string, unknown>>[] = [];
    // Claiming starts on `start()`, never at construction: a job claimed before
    // every pipeline registered its handler has nowhere to go.
    const startConsuming = (
      consumerDependencies: GroupQueueDependencies<Record<string, unknown>>,
    ): RunningGroupQueueConsumer<Record<string, unknown>> => {
      const configuredConsumer = new GroupQueueConsumer(queueDefinition, consumerDependencies);
      return eventingDefinition.processBatch
        ? configuredConsumer.handleBatch({
            each: (payload, context) => refuse(() => eventingDefinition.process(payload, context)),
            batch: (payloads, context) =>
              backOffWhenOverloaded({
                queueName: eventingDefinition.name,
                run: () => refuse(() => eventingDefinition.processBatch!(payloads, context)),
              }),
          })
        : configuredConsumer.handle((payload, context) =>
            refuse(() => eventingDefinition.process(payload, context)),
          );
    };

    return {
      send: (payload, options) => producer.send(payload, options),
      sendBatch: (payloads, options) => producer.sendBatch(payloads, options),
      start() {
        if (!consumersEnabled || consumers.length > 0) return;
        consumers = consumerDependencies({
          dependencies,
          listedKey: allowListKeyFor?.(eventingDefinition.name),
        }).map(startConsuming);
      },
      pause: () => consumers.forEach((each) => each.pause()),
      resume: () => consumers.forEach((each) => each.resume()),
      async waitUntilReady() {
        await Promise.all([
          producer.waitUntilReady(),
          ...consumers.map((each) => each.waitUntilReady()),
        ]);
      },
      async close() {
        await producer.close();
        await Promise.all(consumers.map((each) => each.close()));
      },
    };
  };
}
