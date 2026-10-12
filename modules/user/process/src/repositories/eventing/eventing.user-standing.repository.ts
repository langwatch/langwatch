import type { EventingParticipation, OwnEventStore } from "@langwatch/eventing";
import { USER_DEACTIVATED_EVENT_TYPE, USER_REACTIVATED_EVENT_TYPE } from "@langwatch/user-contract";

import type {
  UserDeactivatedEvent,
  UserReactivatedEvent,
} from "../../eventing/user-lifecycle.events.ts";
import type { UserStandingFact } from "../../rules/user-standing.rules.ts";
import type { UserStandingRepository } from "../user-standing.repository.ts";

type UserLifecycleEventReads = Pick<OwnEventStore, "read">;
type UserStandingEvent = UserDeactivatedEvent | UserReactivatedEvent;

const READ_CONCURRENCY = 50;

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

  /** Each account's deactivated and reactivated facts, oldest first, read a slice at a time. */
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
    const found: { userId: string; facts: UserStandingFact[] }[] = [];
    for (let start = 0; start < userIds.length; start += READ_CONCURRENCY) {
      const slice = userIds.slice(start, start + READ_CONCURRENCY);
      found.push(
        ...(await Promise.all(
          slice.map(async (userId) => {
            const events = await eventStore.read({
              tenantId: userId,
              aggregateId: userId,
              accepts: isUserStandingEvent,
            });
            return {
              userId,
              facts: events.map((event): UserStandingFact => ({
                type: event.type === USER_DEACTIVATED_EVENT_TYPE ? "deactivated" : "reactivated",
                occurredAt: event.data.occurredAt,
              })),
            };
          }),
        )),
      );
    }
    return found;
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
