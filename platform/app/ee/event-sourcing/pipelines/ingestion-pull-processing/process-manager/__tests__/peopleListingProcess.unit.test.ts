import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import { describe, expect, it } from "vitest";

import { INGESTION_PULL_STALE_LISTING_MS } from "../ingestionPull.process";
import {
  bootConfigured,
  envelope,
  evolve,
  listingKey,
  NEXT_PULL_AT,
  requestedFor,
} from "./listingProcess.fixture";

const peopleKey = (requestId: string) => listingKey("people", requestId);

const requested = requestedFor(
  INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
);

describe("people listing on the ingestion pull process manager", () => {
  describe("when a listing is requested", () => {
    it("dispatches exactly one listPeople intent for the request", () => {
      const booted = bootConfigured();
      const at = Date.parse("2026-09-09T10:03:00Z");
      const result = evolve({
        previousState: booted.state,
        ...requested({ requestId: "req-1", at }),
      });

      expect(result.intents).toEqual([
        {
          messageKey: peopleKey("req-1"),
          intentType: "listPeople",
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: at,
          },
        },
      ]);
    });

    /**
     * The failure this whole file exists to rule out.
     *
     * The process manager owns each source's cron wake and every handler
     * returns an explicit `nextWakeAt`. A handler that returned the wrong one,
     * or none, would silently stop a source from ever pulling again — and it
     * would look like a listing feature working perfectly.
     */
    it("leaves the pull schedule exactly where the configuration put it", () => {
      const booted = bootConfigured();
      const result = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });

      expect(result.nextWakeAt).toBe(booted.nextWakeAt);
      expect(result.nextWakeAt).toBe(NEXT_PULL_AT);
    });

    it("does not disturb the durable cursor", () => {
      const booted = bootConfigured();
      const result = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });

      expect(result.state.cursor).toBe("cursor-1");
      expect(result.state.currentRun).toBeNull();
    });
  });

  describe("when the same request is redelivered", () => {
    it("dispatches the same intent key rather than a second listing", () => {
      const booted = bootConfigured();
      const at = Date.parse("2026-09-09T10:03:00Z");
      const first = evolve({
        previousState: booted.state,
        ...requested({ requestId: "req-1", at }),
      });
      const second = evolve({
        previousState: first.state,
        ...requested({
          requestId: "req-1",
          at,
          now: Date.parse("2026-09-09T10:04:00Z"),
        }),
      });

      expect(second.intents).toHaveLength(1);
      expect(second.intents[0]?.messageKey).toBe(peopleKey("req-1"));
    });
  });

  describe("when a second request arrives while one is still running", () => {
    it("drops it instead of spending another provider call", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const second = evolve({
        previousState: first.state,
        ...requested({
          requestId: "req-2",
          at: Date.parse("2026-09-09T10:03:05Z"),
        }),
      });

      expect(second.intents).toEqual([]);
      expect(second.state.currentPeopleListing?.requestId).toBe("req-1");
    });

    it("still leaves the pull schedule alone", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const second = evolve({
        previousState: first.state,
        ...requested({
          requestId: "req-2",
          at: Date.parse("2026-09-09T10:03:05Z"),
        }),
      });

      expect(second.nextWakeAt).toBe(NEXT_PULL_AT);
    });
  });

  describe("when the in-flight listing is older than the stale window", () => {
    it("abandons it and dispatches the new request", () => {
      const booted = bootConfigured();
      const firstAt = Date.parse("2026-09-09T10:03:00Z");
      const first = evolve({
        previousState: booted.state,
        ...requested({ requestId: "req-1", at: firstAt }),
      });
      const laterAt = firstAt + INGESTION_PULL_STALE_LISTING_MS + 1;
      const second = evolve({
        previousState: first.state,
        ...requested({ requestId: "req-2", at: laterAt }),
      });

      expect(second.intents).toHaveLength(1);
      expect(second.intents[0]?.messageKey).toBe(peopleKey("req-2"));
      expect(second.state.currentPeopleListing?.requestId).toBe("req-2");
    });
  });

  describe("when the listing finishes", () => {
    it("frees the source after a successful listing", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const listed = evolve({
        previousState: first.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
          occurredAt: Date.parse("2026-09-09T10:03:30Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: Date.parse("2026-09-09T10:03:00Z"),
            directoryPersonCount: 42,
            withheldPersonCount: 0,
          },
        }),
        now: Date.parse("2026-09-09T10:03:30Z"),
      });

      expect(listed.state.currentPeopleListing).toBeNull();
      expect(listed.intents).toEqual([]);
      expect(listed.nextWakeAt).toBe(NEXT_PULL_AT);
    });

    it("frees the source after a refusal, and keeps the pull scheduled", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const refused = evolve({
        previousState: first.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED,
          occurredAt: Date.parse("2026-09-09T10:03:30Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: Date.parse("2026-09-09T10:03:00Z"),
            reason: "unauthorized",
            status: 403,
          },
        }),
        now: Date.parse("2026-09-09T10:03:30Z"),
      });

      expect(refused.state.currentPeopleListing).toBeNull();
      // A provider refusing to list its staff says nothing about whether it
      // will keep serving the rows the pull reads.
      expect(refused.state.enabled).toBe(true);
      expect(refused.nextWakeAt).toBe(NEXT_PULL_AT);
    });

    it("ignores an outcome from a request it is no longer tracking", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const stale = evolve({
        previousState: first.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
          occurredAt: Date.parse("2026-09-09T10:04:00Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-0",
            requestedAt: Date.parse("2026-09-09T09:00:00Z"),
            directoryPersonCount: 1,
            withheldPersonCount: 0,
          },
        }),
        now: Date.parse("2026-09-09T10:04:00Z"),
      });

      expect(stale.state.currentPeopleListing?.requestId).toBe("req-1");
    });
  });

  describe("when the source is disabled while a listing is in flight", () => {
    it("clears the listing so a re-enabled source is not stuck busy", () => {
      const booted = bootConfigured();
      const first = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });
      const disabled = evolve({
        previousState: first.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
          occurredAt: Date.parse("2026-09-09T10:04:00Z"),
          payload: { sourceId: "source-1", cron: null, cursor: null },
        }),
        now: Date.parse("2026-09-09T10:04:00Z"),
      });

      expect(disabled.state.currentPeopleListing).toBeNull();
      expect(disabled.nextWakeAt).toBeNull();
    });
  });

  describe("when a requested event was committed without a request id", () => {
    it("degrades rather than poisoning the subscriber", () => {
      const booted = bootConfigured();
      const result = evolve({
        previousState: booted.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
          occurredAt: Date.parse("2026-09-09T10:03:00Z"),
          payload: { sourceId: "source-1" },
        }),
        now: Date.parse("2026-09-09T10:03:00Z"),
      });

      expect(result.intents).toEqual([]);
      expect(result.state.currentPeopleListing).toBeNull();
      // Degrading must not cost the source its next pull either.
      expect(result.nextWakeAt).toBe(NEXT_PULL_AT);
    });
  });
});
