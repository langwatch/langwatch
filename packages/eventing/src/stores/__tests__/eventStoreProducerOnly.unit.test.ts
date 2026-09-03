/**
 * @vitest-environment node
 *
 * Spec: packages/eventing/specs/producer-only-event-store.feature
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { Command, CommandHandler } from "../../commands/command";
import { defineCommandSchema } from "../../commands/commandSchema";
import { defineAggregate, defineEvents } from "../../domain/definitions";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSourcing } from "../../eventSourcing";
import { definePipeline } from "../../pipeline/staticBuilder";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../queues/queue.types";
import { EventUtils } from "../../utils/event.utils";
import { EventStoreProducerOnly } from "../eventStoreProducerOnly";
import type { EventStoreReadContext } from "../eventStore.types";

const readContext: EventStoreReadContext = { tenantId: createTenantId("organization-1") };

type RecordedEvent = Event<{ note: string }> & { type: "producer.recorded" };

const recordPayloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  note: z.string(),
});

class RecordCommand implements CommandHandler<
  Command<z.infer<typeof recordPayloadSchema>>,
  RecordedEvent
> {
  static readonly schema = defineCommandSchema("record", recordPayloadSchema, "Record one note");

  static getAggregateId(payload: { aggregateId: string }): string {
    return payload.aggregateId;
  }

  handle(command: Command<{ aggregateId: string; note: string }>): RecordedEvent[] {
    return [
      EventUtils.createEvent<RecordedEvent>({
        aggregateType: "trace",
        aggregateId: command.data.aggregateId,
        tenantId: createTenantId(command.tenantId),
        type: "producer.recorded",
        version: "1",
        data: { note: command.data.note },
        metadata: {},
      }),
    ];
  }
}

function producerPipeline() {
  return definePipeline<RecordedEvent>({
    name: "producer-only-pipeline",
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(["producer.recorded"] as const),
    }),
  })
    .withCommand("record", RecordCommand)
    .build();
}

/**
 * A queue that records what a producer sent it and never processes anything —
 * the shape a producer-only process actually has, where the handler that would
 * append lives in another process entirely.
 */
function recordingQueueFactory() {
  const sent: Record<string, unknown>[] = [];
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send(payload) {
      sent.push(payload);
    },
    async sendBatch(payloads) {
      sent.push(...payloads);
    },
    async waitUntilReady() {},
    async close() {},
  });
  return { sent, factory };
}

describe("EventStoreProducerOnly", () => {
  describe("given a producer-only event store composed for a named process", () => {
    const store = EventStoreProducerOnly.create({ processName: "langwatch-api" });

    /** @scenario "An append is refused rather than accepted and lost" */
    it("refuses an append instead of accepting one it could never durably keep", async () => {
      await expect(store.storeEvents([], readContext, "trace")).rejects.toThrow(
        /langwatch-api.*storeEvents/s,
      );
    });

    /** @scenario "Every read is refused on the same terms" */
    it("refuses every read operation, each naming itself", async () => {
      const reads: Array<[string, Promise<unknown>]> = [
        [
          "getEvent",
          store.getEvent({
            eventId: "event-1",
            tenantId: createTenantId("organization-1"),
            aggregateType: "trace",
            aggregateId: "aggregate-1",
          }),
        ],
        ["getEvents", store.getEvents("aggregate-1", readContext, "trace")],
        [
          "getEventsOccurredSince",
          store.getEventsOccurredSince("aggregate-1", readContext, "trace", 0),
        ],
        ["getEventsUpTo", store.getEventsUpTo("aggregate-1", readContext, "trace", {} as Event)],
        [
          "countEventsBefore",
          store.countEventsBefore("aggregate-1", readContext, "trace", 0, "event-1"),
        ],
      ];

      for (const [operation, read] of reads) {
        await expect(read).rejects.toThrow(new RegExp(operation));
      }
    });
  });

  describe("given a runtime whose event store is the producer-only one", () => {
    /** @scenario "Commands still reach the shared queue" */
    it("registers a real pipeline whose commands reach the queue", async () => {
      const queue = recordingQueueFactory();
      const eventSourcing = new EventSourcing({
        eventStore: EventStoreProducerOnly.create({ processName: "langwatch-api" }),
        queueFactory: queue.factory,
        consumersEnabled: false,
        executionTarget: "api",
      });

      const pipeline = eventSourcing.register(producerPipeline());
      await pipeline.commands.record.send({
        tenantId: "organization-1",
        aggregateId: "aggregate-1",
        note: "produced here, appended elsewhere",
      });

      expect(queue.sent).toHaveLength(1);
      expect(queue.sent[0]).toMatchObject({
        __pipelineName: "producer-only-pipeline",
        aggregateId: "aggregate-1",
        note: "produced here, appended elsewhere",
      });
    });

    // The registration this replaces returned a `DisabledPipeline`, whose
    // commands resolve without ever reaching a queue. Nothing about the two
    // call sites differs, so the send above proves nothing on its own.
    /** @scenario "Commands still reach the shared queue" */
    it("does not substitute the pipeline that would drop those commands", () => {
      const queue = recordingQueueFactory();
      const eventSourcing = new EventSourcing({
        eventStore: EventStoreProducerOnly.create({ processName: "langwatch-api" }),
        queueFactory: queue.factory,
        consumersEnabled: false,
      });

      const pipeline = eventSourcing.register(producerPipeline());

      expect(pipeline.constructor.name).not.toBe("DisabledPipeline");
    });
  });
});
