import { createTenantId, type EventReadSeat } from "@langwatch/eventing";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
} from "@langwatch/user-contract";

import type {
  UserDeactivatedEvent,
  UserReactivatedEvent,
} from "../../eventing/user-lifecycle.events.ts";
import type { UserStandingFact } from "../../rules/user-standing.rules.ts";
import { UserStandingRepository } from "../user-standing.repository.ts";

/** The one read this repository takes off eventing's read seat. */
type UserLifecycleEventReads = Pick<EventReadSeat, "findEventsOfAggregates">;
type UserStandingEvent = UserDeactivatedEvent | UserReactivatedEvent;

const USER_STANDING_EVENT_TYPES: ReadonlySet<unknown> = new Set([
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
]);

/**
 * User's own lifecycle log, read through eventing's read seat, which answers in a process that
 * only sends commands too: the created-facts step runs in one.
 */
export class EventingUserStandingRepository extends UserStandingRepository {
  static create(deps: { eventReadSeat: UserLifecycleEventReads }): EventingUserStandingRepository {
    return new EventingUserStandingRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: UserLifecycleEventReads) {
    super();
  }

  /** Each account's deactivated and reactivated facts, oldest first, in one read of the log. */
  async findStandingFactsOf({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<{ userId: string; facts: UserStandingFact[] }[]> {
    if (userIds.length === 0) return [];
    const events: readonly unknown[] = await this.eventReadSeat.findEventsOfAggregates({
      aggregateType: USER_AGGREGATE_TYPE,
      aggregates: userIds.map((userId) => ({
        tenantId: createTenantId(userId),
        aggregateId: userId,
      })),
    });
    const byUser = new Map(userIds.map((userId) => [userId, new Array<UserStandingFact>()]));
    for (const event of events) {
      if (!isUserStandingEvent(event)) continue;
      byUser.get(event.aggregateId)?.push({
        type: event.type === USER_DEACTIVATED_EVENT_TYPE ? "deactivated" : "reactivated",
        occurredAt: event.data.occurredAt,
      });
    }
    return [...byUser].map(([userId, facts]) => ({ userId, facts }));
  }
}

function isUserStandingEvent(event: unknown): event is UserStandingEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    USER_STANDING_EVENT_TYPES.has(event.type)
  );
}
