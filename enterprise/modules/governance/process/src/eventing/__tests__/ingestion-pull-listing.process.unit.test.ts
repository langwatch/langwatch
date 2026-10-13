import { INGESTION_PULL_EVENT_TYPES } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { INGESTION_PULL_STALE_LISTING_MS } from "../ingestion-pull.process.ts";
import { CADENCE_MS, configuredState, onEvent } from "./ingestion-pull.fixtures.ts";

/** The key a listing parks under: the framework prefixes the process and aggregate. */
const listingKey = (kind: "agents" | "people", requestId: string) =>
  `process:source-1:${kind}:${requestId}`;

const requestAgents = (requestId: string) => ({ sourceId: "source-1", requestId });
const agentsListed = (requestId: string) => ({
  sourceId: "source-1",
  requestId,
  requestedAt: 1_000,
  agentCount: 3,
});
const agentsRefused = (requestId: string) => ({
  sourceId: "source-1",
  requestId,
  requestedAt: 1_000,
  reason: "forbidden",
  status: 403,
});

describe("agent listing on the ingestion pull process manager", () => {
  describe("when a listing is requested", () => {
    it("dispatches exactly one listAgents intent keyed on the request", () => {
      const result = onEvent({
        state: configuredState(),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        data: requestAgents("req-1"),
        occurredAt: 5_000,
      });

      expect(result.intents).toEqual([
        {
          messageKey: listingKey("agents", "req-1"),
          intentType: "listAgents",
          payload: { sourceId: "source-1", requestId: "req-1", requestedAt: 5_000 },
        },
      ]);
    });

    it("leaves the pull schedule and the durable cursor alone", () => {
      const result = onEvent({
        state: configuredState(),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        data: requestAgents("req-1"),
        occurredAt: 5_000,
      });

      expect(result.nextWakeAt).toBe(5_000 + CADENCE_MS);
      expect(result.state).toMatchObject({
        cursor: "cursor-1",
        currentAgentsListing: { requestId: "req-1", startedAt: 5_000 },
      });
    });
  });

  describe("when a second request arrives while one is still running", () => {
    it("drops it instead of spending another provider call", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        data: requestAgents("req-2"),
        occurredAt: 2_000,
      });

      expect(result.intents).toEqual([]);
      expect(result.state).toMatchObject({ currentAgentsListing: { requestId: "req-1" } });
    });
  });

  describe("when the in-flight listing is older than the stale window", () => {
    it("abandons it and dispatches the new request", () => {
      const now = 1_000 + INGESTION_PULL_STALE_LISTING_MS;
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        data: requestAgents("req-2"),
        occurredAt: now,
      });

      expect(result.intents.map((intent) => intent.messageKey)).toEqual([
        listingKey("agents", "req-2"),
      ]);
    });
  });

  describe("when the listing finishes", () => {
    it("frees the source after a successful listing", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
        data: agentsListed("req-1"),
      });

      expect(result.state).toMatchObject({ currentAgentsListing: null });
    });

    it("frees the source after a refusal, and keeps the pull scheduled", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
        data: agentsRefused("req-1"),
        occurredAt: 3_000,
      });

      expect(result.state).toMatchObject({ currentAgentsListing: null });
      expect(result.nextWakeAt).toBe(3_000 + CADENCE_MS);
    });

    it("ignores an outcome from a request it is no longer tracking", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-2", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED,
        data: agentsListed("req-1"),
      });

      expect(result.state).toMatchObject({ currentAgentsListing: { requestId: "req-2" } });
    });
  });

  describe("when the source is disabled", () => {
    it("clears the listing so a re-enabled source is not stuck busy", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
        data: { sourceId: "source-1", configVersion: "v2" },
      });

      expect(result.state).toMatchObject({
        currentAgentsListing: null,
        currentPeopleListing: null,
      });
    });

    it("asks nothing for a request that arrives after the disable", () => {
      const result = onEvent({
        state: configuredState({ enabled: false, cron: null }),
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED,
        data: requestAgents("req-1"),
      });

      expect(result.intents).toEqual([]);
      expect(result.state).toMatchObject({ currentAgentsListing: null });
    });
  });
});

describe("given agents and people listings on one source", () => {
  describe("when an agent listing is already in flight", () => {
    it("still dispatches the people listing, keyed apart", () => {
      const result = onEvent({
        state: configuredState({ currentAgentsListing: { requestId: "req-1", startedAt: 1_000 } }),
        eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
        data: { sourceId: "source-1", requestId: "req-1" },
      });

      expect(result.intents).toMatchObject([
        { messageKey: listingKey("people", "req-1"), intentType: "listPeople" },
      ]);
    });
  });

  describe("when a people listing settles", () => {
    it("leaves an in-flight agent listing untouched", () => {
      const result = onEvent({
        state: configuredState({
          currentAgentsListing: { requestId: "req-1", startedAt: 1_000 },
          currentPeopleListing: { requestId: "req-1", startedAt: 1_000 },
        }),
        eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED,
        data: {
          sourceId: "source-1",
          requestId: "req-1",
          requestedAt: 1_000,
          directoryPersonCount: 5,
          withheldPersonCount: 1,
        },
      });

      expect(result.state).toMatchObject({
        currentAgentsListing: { requestId: "req-1" },
        currentPeopleListing: null,
      });
    });
  });
});
