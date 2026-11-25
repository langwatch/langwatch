import { describe, expect, it } from "vitest";

import type { Event } from "../../../domain/types.ts";
import type { JobDelivery } from "../../../queues/index.ts";
import {
  createTestEvent,
  createTestTenantId,
  parseTestEvent,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers.ts";
import type { JobRegistryEntry } from "../jobLane.ts";
import { QueueManager } from "../queueManager.ts";

describe("subscriber delivery attempt", () => {
  describe("when the queue delivers a subscriber job on its third attempt", () => {
    /** @scenario "A subscriber is told which delivery attempt it is running" */
    it("passes the attempt to the subscriber's read context", async () => {
      const registry = new Map<string, JobRegistryEntry>();
      const queueManager = new QueueManager<Event>({
        parseEvent: parseTestEvent,
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        globalQueue: {} as never,
        globalJobRegistry: registry,
      });

      const seenContexts: unknown[] = [];
      queueManager.initializeSubscriberQueues(
        {
          mySubscriber: {
            name: "mySubscriber",
            handler: { handle: async () => {} },
            options: {},
          },
        },
        async (_name, _event, context) => {
          seenContexts.push(context);
        },
      );

      const entry = [...registry.values()][0]!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        createTestTenantId(),
      );
      const delivery: JobDelivery = { attempt: 3 };
      await entry.read(event).run(delivery);

      expect(seenContexts[0]).toMatchObject({ deliveryAttempt: 3 });
    });
  });
});
