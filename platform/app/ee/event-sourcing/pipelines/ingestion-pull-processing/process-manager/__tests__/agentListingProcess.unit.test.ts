import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import { describe, expect, it } from "vitest";

import { INGESTION_PULL_STALE_LISTING_MS } from "../ingestionPull.process";
import {
  bootConfigured,
  envelope,
  evolve,
  listingKey as listingKeyFor,
  requestedFor,
} from "./listingProcess.fixture";

const listingKey = (requestId: string) => listingKeyFor("agents", requestId);

const requested = requestedFor(
  INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
);

describe("agent listing on the ingestion pull process manager", () => {
  describe("when a listing is requested", () => {
    it("dispatches exactly one listAgents intent for the request", () => {
      const booted = bootConfigured();
      const at = Date.parse("2026-09-09T10:03:00Z");
      const result = evolve({
        previousState: booted.state,
        ...requested({ requestId: "req-1", at }),
      });

      expect(result.intents).toEqual([
        {
          messageKey: listingKey("req-1"),
          intentType: "listAgents",
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: at,
          },
        },
      ]);
    });

    it("leaves the pull schedule exactly where the configuration put it", () => {
      const booted = bootConfigured();
      const result = evolve({
        previousState: booted.state,
        ...requested({
          requestId: "req-1",
          at: Date.parse("2026-09-09T10:03:00Z"),
        }),
      });

      // The whole point of not reusing handlePullConfigured: asking about
      // agents must not push the source's next pull anywhere.
      expect(result.nextWakeAt).toBe(booted.nextWakeAt);
      expect(result.nextWakeAt).toBe(Date.parse("2026-09-09T10:15:00Z"));
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
      expect(second.intents[0]?.messageKey).toBe(listingKey("req-1"));
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
      expect(second.state.currentAgentsListing?.requestId).toBe("req-1");
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

      expect(second.nextWakeAt).toBe(Date.parse("2026-09-09T10:15:00Z"));
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
      expect(second.intents[0]?.messageKey).toBe(listingKey("req-2"));
      expect(second.state.currentAgentsListing?.requestId).toBe("req-2");
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
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
          occurredAt: Date.parse("2026-09-09T10:03:30Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: Date.parse("2026-09-09T10:03:00Z"),
            agentCount: 4,
          },
        }),
        now: Date.parse("2026-09-09T10:03:30Z"),
      });

      expect(listed.state.currentAgentsListing).toBeNull();
      expect(listed.intents).toEqual([]);
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
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
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

      expect(refused.state.currentAgentsListing).toBeNull();
      // A provider refusing to list agents says nothing about transcripts.
      expect(refused.state.enabled).toBe(true);
      expect(refused.nextWakeAt).toBe(Date.parse("2026-09-09T10:15:00Z"));
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
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
          occurredAt: Date.parse("2026-09-09T10:04:00Z"),
          payload: {
            sourceId: "source-1",
            requestId: "req-0",
            requestedAt: Date.parse("2026-09-09T09:00:00Z"),
            agentCount: 1,
          },
        }),
        now: Date.parse("2026-09-09T10:04:00Z"),
      });

      expect(stale.state.currentAgentsListing?.requestId).toBe("req-1");
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

      expect(disabled.state.currentAgentsListing).toBeNull();
      expect(disabled.nextWakeAt).toBeNull();
    });
  });

  describe("when a requested event was committed without a request id", () => {
    it("degrades rather than poisoning the subscriber", () => {
      const booted = bootConfigured();
      const result = evolve({
        previousState: booted.state,
        event: envelope({
          eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
          occurredAt: Date.parse("2026-09-09T10:03:00Z"),
          payload: { sourceId: "source-1" },
        }),
        now: Date.parse("2026-09-09T10:03:00Z"),
      });

      expect(result.intents).toEqual([]);
      expect(result.state.currentAgentsListing).toBeNull();
      expect(result.nextWakeAt).toBe(Date.parse("2026-09-09T10:15:00Z"));
    });
  });
});
