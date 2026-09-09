import { ingestionPullPM } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/pipeline";
import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import { describe, expect, it } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
} from "~/server/event-sourcing/process-manager";
import { buildProcessDefinition } from "~/server/event-sourcing/process-manager/processRuntime";

import { INGESTION_PULL_STALE_LISTING_MS } from "../ingestionPull.process";
import {
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
} from "../ingestionPullProcess.types";

/** Built through the pipeline's own applier, like the pull tests. */
const definition = buildProcessDefinition(
  buildProcessManager<IngestionPullProcessingEvent>({
    name: INGESTION_PULL_PROCESS_NAME,
    applier: ingestionPullPM({
      runPort: { run: () => Promise.reject(new Error("unused")) },
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      commands: () => {
        throw new Error("unused in evolve tests");
      },
    }),
  }).config,
) as ProcessDefinition<IngestionPullProcessState>;

const ref = {
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
};

const peopleKey = (requestId: string) =>
  `process:${encodeURIComponent("source-1")}:people:${requestId}`;
const agentsKey = (requestId: string) =>
  `process:${encodeURIComponent("source-1")}:agents:${requestId}`;

const CONFIGURED_AT = Date.parse("2026-09-09T10:00:00Z");
/** The wake the cron in `bootConfigured` produces, named once. */
const NEXT_PULL_AT = Date.parse("2026-09-09T10:15:00Z");

function envelope({
  eventType,
  occurredAt,
  payload,
}: {
  eventType: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}): ProcessEventEnvelope {
  return {
    eventId: `event-${eventType}-${occurredAt}`,
    eventType,
    occurredAt,
    tenantId: "gov-project",
    projectId: "gov-project",
    processKey: "source-1",
    payload: { cron: null, cursor: null, runId: null, ...payload },
  };
}

function evolve({
  previousState,
  event,
  now,
}: {
  previousState: IngestionPullProcessState;
  event: ProcessEventEnvelope;
  now: number;
}) {
  const input: ProcessInput = { kind: "event", event, now };
  return definition.evolve({ previousState, input, ref });
}

/** A configured, cron-scheduled source — the state every listing starts from. */
function bootConfigured() {
  return evolve({
    previousState: definition.initialState,
    event: envelope({
      eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
      occurredAt: CONFIGURED_AT,
      payload: {
        sourceId: "source-1",
        cron: "*/15 * * * *",
        cursor: "cursor-1",
        runId: null,
      },
    }),
    now: CONFIGURED_AT,
  });
}

function requested({
  requestId,
  at,
  now,
}: {
  requestId: string;
  at: number;
  now?: number;
}) {
  return {
    event: envelope({
      eventType: INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED,
      occurredAt: at,
      payload: { sourceId: "source-1", requestId },
    }),
    now: now ?? at,
  };
}

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
            personCount: 42,
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
            personCount: 1,
          },
        }),
        now: Date.parse("2026-09-09T10:04:00Z"),
      });

      expect(stale.state.currentPeopleListing?.requestId).toBe("req-1");
    });

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
            personCount: 2,
          },
        }),
        now: Date.parse("2026-09-09T10:03:30Z"),
      });

      expect(listed.state.currentPeopleListing).toBeNull();
      expect(listed.state.currentAgentsListing?.requestId).toBe("agents-1");
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
