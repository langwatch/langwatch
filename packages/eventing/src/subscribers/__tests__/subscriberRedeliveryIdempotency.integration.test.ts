import { beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../..//index.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import { ProjectionRouter } from "../../projections/projectionRouter.ts";
import { TEST_CONSTANTS, TEST_EVENT_TYPES } from "../../services/__tests__/testHelpers.ts";
import { QueueManager } from "../../services/queues/queueManager.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import type { Event } from "../../domain/types.ts";

/**
 * Delivery is at-least-once, so a handler that completed and then lost its
 * acknowledgement is delivered again. What keeps the second delivery from
 * repeating the externally visible action is the action's IDENTITY: derived
 * from the subscriber and the source event, so the redelivery re-derives the
 * same key and the target collapses it onto the row already there.
 *
 * The action here is an append to the event log, which is the target every
 * subscriber's side effects ultimately reach.
 */

const aggregateType: AggregateType = "trace";
const tenantId = createTenantId("tenant-redelivery");
const eventType = TEST_EVENT_TYPES[0];

function sourceEvent(): Event {
  return EventUtils.createEvent({
    aggregateType,
    aggregateId: "aggregate-1",
    tenantId,
    type: eventType,
    version: "2025-12-17",
    data: { value: "source" },
    createdAt: 1_000,
  }) as Event;
}

describe("subscriber redelivery", () => {
  let store: EventStoreMemory;

  beforeEach(() => {
    store = EventStoreMemory.createForTesting();
  });

  /**
   * A handler whose action is an append keyed on the subscriber and the source
   * event, exactly as a production side effect derives its identity.
   */
  function actionHandler(subscriberName: string) {
    return async (event: Event) => {
      const action = EventUtils.createEvent({
        aggregateType,
        aggregateId: event.aggregateId,
        tenantId,
        type: TEST_EVENT_TYPES[1],
        version: "2025-12-17",
        data: { source: event.id },
        createdAt: 2_000,
        idempotencyKey: `${subscriberName}:${event.id}`,
      }) as Event;
      await store.storeEvents([action], { tenantId }, aggregateType);
    };
  }

  async function actionCount(aggregateId: string): Promise<number> {
    const events = await store.getEvents(aggregateId, { tenantId } as never, aggregateType);
    return events.filter((event) => event.type === TEST_EVENT_TYPES[1]).length;
  }

  describe.each([{ subscriber: "event" }, { subscriber: "projection" }])(
    "given a $subscriber subscriber performs an externally visible action",
    ({ subscriber }) => {
      describe("when the same source event is delivered again after a lost acknowledgement", () => {
        /** @scenario Subscriber redelivery does not repeat its action */
        it("leaves one result for that action identity and completes without repeating it", async () => {
          const router = new ProjectionRouter<Event>(
            aggregateType,
            TEST_CONSTANTS.PIPELINE_NAME,
            new QueueManager<Event>({
              aggregateType,
              pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
            }),
          );
          const name = `${subscriber}Subscriber`;
          router.registerEventSubscriber({
            name,
            eventTypes: [],
            handle: actionHandler(name),
          });

          const event = sourceEvent();
          const readContext = { tenantId };

          await router.dispatch([event], readContext as never);
          // The acknowledgement was lost; the queue delivers the same event.
          await expect(router.dispatch([event], readContext as never)).resolves.not.toThrow();

          expect(await actionCount(event.aggregateId)).toBe(1);
        });
      });
    },
  );
});
