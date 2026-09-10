/**
 * Agents and people listings share one process and must not share a slot.
 *
 * Its own file because the claim is about the PAIR, and it was previously
 * asserted from inside the people suite — which made it look like a fact about
 * people listings, and left the agents suite with no reason to care. Either
 * suite could have been rewritten without anybody noticing this went missing.
 *
 * The two lists ask different providers different questions. One in flight is
 * no reason to refuse the other, and a shared slot would have made a people
 * sync silently drop whenever an agent sync happened to be running.
 */

import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import { describe, expect, it } from "vitest";

import {
  bootConfigured,
  envelope,
  evolve,
  listingKey,
  requestedFor,
} from "./listingProcess.fixture";

const peopleKey = (requestId: string) => listingKey("people", requestId);
const agentsKey = (requestId: string) => listingKey("agents", requestId);

const requested = requestedFor(
  INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
);

describe("given agents and people listings on one source", () => {
  describe("when an agent listing is already in flight", () => {
    /**
     * The two lists ask different providers different questions, so one in
     * flight is no reason to refuse the other. Sharing a slot would have made
     * a people sync silently drop whenever an agent sync was running.
     */
    it("still dispatches the people listing", () => {
      const booted = bootConfigured();
      const agents = evolve({
        previousState: booted.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
          occurredAt: Date.parse("2026-09-09T10:02:00Z"),
          payload: { sourceId: "source-1", requestId: "agents-1" },
        }),
        now: Date.parse("2026-09-09T10:02:00Z"),
      });
      const people = evolve({
        previousState: agents.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });

      expect(people.intents).toHaveLength(1);
      expect(people.intents[0]?.messageKey).toBe(peopleKey("req-1"));
      // And the agent listing is left exactly where it was.
      expect(people.state.currentAgentsListing?.requestId).toBe("agents-1");
      expect(people.state.currentPeopleListing?.requestId).toBe("req-1");
    });

    it("keys the two intents apart so neither collapses onto the other", () => {
      const booted = bootConfigured();
      const agents = evolve({
        previousState: booted.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
          occurredAt: Date.parse("2026-09-09T10:02:00Z"),
          // Deliberately the SAME request id as the people listing below.
          payload: { sourceId: "source-1", requestId: "req-1" },
        }),
        now: Date.parse("2026-09-09T10:02:00Z"),
      });
      const people = evolve({
        previousState: agents.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });

      expect(agents.intents[0]?.messageKey).toBe(agentsKey("req-1"));
      expect(people.intents[0]?.messageKey).toBe(peopleKey("req-1"));
      expect(people.intents[0]?.messageKey).not.toBe(
        agents.intents[0]?.messageKey,
      );
    });
  });

  describe("when a people listing settles", () => {
    it("leaves an in-flight agent listing untouched", () => {
      const booted = bootConfigured();
      const agents = evolve({
        previousState: booted.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
          occurredAt: Date.parse("2026-09-09T10:02:00Z"),
          payload: { sourceId: "source-1", requestId: "agents-1" },
        }),
        now: Date.parse("2026-09-09T10:02:00Z"),
      });
      const people = evolve({
        previousState: agents.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const listed = evolve({
        previousState: people.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
          occurredAt: Date.parse("2026-09-09T10:03:30Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: Date.parse("2026-09-09T10:03:00Z"),
            directoryPersonCount: 2,
            withheldPersonCount: 0,
          },
        }),
        now: Date.parse("2026-09-09T10:03:30Z"),
      });

      expect(listed.state.currentPeopleListing).toBeNull();
      expect(listed.state.currentAgentsListing?.requestId).toBe("agents-1");
    });
  });
});
