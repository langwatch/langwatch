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
type UserLifecycleEventReads = Pick<EventReadSeat, "getEvents">;
type UserStandingEvent = UserDeactivatedEvent | UserReactivatedEvent;

const USER_STANDING_EVENT_TYPES: ReadonlySet<unknown> = new Set([
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
]);

/**
 * User's own lifecycle log, read through eventing's read seat, which answers in a process that
 * only sends commands too: the standing step runs in one.
 */
export class EventingUserStandingRepository extends UserStandingRepository {
  static create(deps: { eventReadSeat: UserLifecycleEventReads }): EventingUserStandingRepository {
    return new EventingUserStandingRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: UserLifecycleEventReads) {
    super();
  }

  /** The account's deactivated and reactivated facts, oldest first. */
  async findStandingFacts({ userId }: { userId: string }): Promise<UserStandingFact[]> {
    const events: readonly unknown[] = await this.eventReadSeat.getEvents({
      tenantId: createTenantId(userId),
      aggregateType: USER_AGGREGATE_TYPE,
      aggregateId: userId,
    });

    return events.filter(isUserStandingEvent).map((event): UserStandingFact => ({
      type: event.type === USER_DEACTIVATED_EVENT_TYPE ? "deactivated" : "reactivated",
      occurredAt: event.data.occurredAt,
    }));
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
