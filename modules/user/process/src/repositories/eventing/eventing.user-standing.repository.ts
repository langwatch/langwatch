import type { EventingParticipation, OwnEventStore } from "@langwatch/eventing";
import { USER_DEACTIVATED_EVENT_TYPE, USER_REACTIVATED_EVENT_TYPE } from "@langwatch/user-contract";

import type {
  UserDeactivatedEvent,
  UserReactivatedEvent,
} from "../../eventing/user-lifecycle.events.ts";
import type { UserStandingFact } from "../../rules/user-standing.rules.ts";
import type { UserStandingRepository } from "../user-standing.repository.ts";

type UserLifecycleEventReads = Pick<OwnEventStore, "findAggregates">;
type UserStandingEvent = UserDeactivatedEvent | UserReactivatedEvent;

const USER_STANDING_EVENT_TYPES: ReadonlySet<unknown> = new Set([
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
]);

/**
 * User's own lifecycle log, read through the user_lifecycle pipeline's own store (record §7,
 * Alex, 2026-10-05), kept once the process builds the pipeline; a read before then refuses.
 */
export class EventingUserStandingRepository implements UserStandingRepository {
  static create(): EventingUserStandingRepository {
    return new EventingUserStandingRepository();
  }

  #eventStore: UserLifecycleEventReads | undefined;

  private constructor() {}

  /** A build only to be listed keeps nothing: in a producer role it runs after registration. */
  keep(input: {
    participation: EventingParticipation;
    eventStore: UserLifecycleEventReads | undefined;
  }): void {
    if (input.participation === "describe" || input.eventStore === void 0) return;
    this.#eventStore = input.eventStore;
  }

  /** Each account's deactivated and reactivated facts, oldest first, in one read of the log. */
  async findStandingFactsOf({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<{ userId: string; facts: UserStandingFact[] }[]> {
    const eventStore = this.#eventStore;
    if (!eventStore) {
      // A plain Error on purpose (error doctrine): the caller cannot act on an absent log.
      throw new Error("user's user_lifecycle pipeline cannot read: never built over a store");
    }
    if (userIds.length === 0) return [];
    const found = await eventStore.findAggregates({
      aggregates: userIds.map((userId) => ({ tenantId: userId, aggregateId: userId })),
      accepts: isUserStandingEvent,
    });
    return found.map(({ aggregateId, events }) => ({
      userId: aggregateId,
      facts: events.map((event): UserStandingFact => ({
        type: event.type === USER_DEACTIVATED_EVENT_TYPE ? "deactivated" : "reactivated",
        occurredAt: event.data.occurredAt,
      })),
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
