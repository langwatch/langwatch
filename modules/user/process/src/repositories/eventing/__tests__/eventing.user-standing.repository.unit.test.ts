/**
 * @vitest-environment node
 * Accounts' standing facts, read through eventing's read seat in each account's own tenant.
 * @see modules/user/specs/user.feature
 */
import {
  createTenantId,
  EventLogReadSeat,
  EventStoreProducerOnly,
  eventToRecord,
  EventUtils,
  PipelineEventStore,
} from "@langwatch/eventing";
import { EventRepositoryMemory } from "@langwatch/eventing/testing";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_LIFECYCLE_PIPELINE_NAME,
  USER_REACTIVATED_EVENT_TYPE,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type {
  UserDeactivatedEvent,
  UserReactivatedEvent,
} from "../../../eventing/user-lifecycle.events.ts";
import { EventingUserStandingRepository } from "../eventing.user-standing.repository.ts";

const SAM = "user_sam";
const ALEX = "user_alex";
const TASKS_PROCESS = "langwatch-tasks";

function standing({
  type,
  occurredAt,
}: {
  type: typeof USER_DEACTIVATED_EVENT_TYPE | typeof USER_REACTIVATED_EVENT_TYPE;
  occurredAt: number;
}): UserDeactivatedEvent | UserReactivatedEvent {
  const fields = {
    aggregateType: USER_AGGREGATE_TYPE,
    aggregateId: SAM,
    tenantId: createTenantId(SAM),
    version: USER_LIFECYCLE_EVENT_VERSION,
    data: { tenantId: SAM, userId: SAM, occurredAt },
    metadata: {},
    occurredAt,
  };
  return type === USER_DEACTIVATED_EVENT_TYPE
    ? EventUtils.createEvent<UserDeactivatedEvent>({ ...fields, type })
    : EventUtils.createEvent<UserReactivatedEvent>({ ...fields, type });
}

function isAnyEvent(_event: unknown): _event is unknown {
  return true;
}

/** What a producer composes: a store refusing every read, and a read seat over the same log. */
async function producerOver(events: (UserDeactivatedEvent | UserReactivatedEvent)[]) {
  const log = EventRepositoryMemory.createForTesting();
  await log.insertEventRecords(events.map((event) => eventToRecord(event)));
  const refusingStore = EventStoreProducerOnly.create({ processName: TASKS_PROCESS });
  const ownStore = PipelineEventStore.create({
    pipeline: USER_LIFECYCLE_PIPELINE_NAME,
    log: () => refusingStore,
  });
  ownStore.bindTo({ aggregate: { type: USER_AGGREGATE_TYPE } });
  return {
    ownStore,
    repository: EventingUserStandingRepository.create({
      eventReadSeat: EventLogReadSeat.create({ repository: log }),
    }),
  };
}

describe("given an account whose log holds a deactivation and then a reactivation", () => {
  const events = [
    standing({ type: USER_DEACTIVATED_EVENT_TYPE, occurredAt: 5 }),
    standing({ type: USER_REACTIVATED_EVENT_TYPE, occurredAt: 9 }),
  ];

  describe("when a page's standing facts are read in a process that only sends commands", () => {
    /** @scenario "The created-facts step reads user's log from a process that only sends commands" */
    it("lists each account's facts oldest first while the own store refuses the read", async () => {
      const { repository, ownStore } = await producerOver(events);

      const found = await repository.findStandingFactsOf({ userIds: [SAM, ALEX] });

      expect(found).toEqual([
        {
          userId: SAM,
          facts: [
            { type: "deactivated", occurredAt: 5 },
            { type: "reactivated", occurredAt: 9 },
          ],
        },
        { userId: ALEX, facts: [] },
      ]);
      await expect(
        ownStore.findAggregates({
          aggregates: [{ tenantId: SAM, aggregateId: SAM }],
          accepts: isAnyEvent,
        }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { processName: TASKS_PROCESS, operation: "findEventsOfAggregates" },
      });
    });

    /** @scenario "The created-facts step reads user's log from a process that only sends commands" */
    it("reads nothing for an empty page", async () => {
      const { repository } = await producerOver(events);

      await expect(repository.findStandingFactsOf({ userIds: [] })).resolves.toEqual([]);
    });
  });
});
