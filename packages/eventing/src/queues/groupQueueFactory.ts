import { randomUUID } from "node:crypto";
import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueProducer,
  type GroupQueueDependencies,
  type RunningGroupQueueConsumer,
} from "@langwatch/group-queue";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "./queue.types";

export interface EventingGroupQueueFactoryOptions {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  consumersEnabled?: boolean;
}

/**
 * Adapts the capability-split Group Queue API to Eventing's shared runtime
 * queue port. Application composition owns the Redis and storage dependencies;
 * Eventing owns only the routing definition and handler registry.
 */
export function createEventingGroupQueueFactory({
  dependencies,
  consumersEnabled = true,
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
      groupBy: (payload) =>
        eventingDefinition.groupKey?.(payload) ?? randomUUID(),
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
    });

    const producer = new GroupQueueProducer(queueDefinition, dependencies);
    let consumer: RunningGroupQueueConsumer<Record<string, unknown>> | undefined;
    if (consumersEnabled) {
      const configuredConsumer = new GroupQueueConsumer(
        queueDefinition,
        dependencies,
      );
      consumer = eventingDefinition.processBatch
        ? configuredConsumer.handleBatch({
            each: (payload, context) =>
              eventingDefinition.process(payload, context),
            batch: (payloads, context) =>
              eventingDefinition.processBatch!(payloads, context),
          })
        : configuredConsumer.handle((payload, context) =>
            eventingDefinition.process(payload, context),
          );
    }

    return {
      send: (payload, options) => producer.send(payload, options),
      sendBatch: (payloads, options) => producer.sendBatch(payloads, options),
      async waitUntilReady() {
        await Promise.all([
          producer.waitUntilReady(),
          consumer?.waitUntilReady(),
        ]);
      },
      async close() {
        await producer.close();
        await consumer?.close();
      },
    };
  };
}
