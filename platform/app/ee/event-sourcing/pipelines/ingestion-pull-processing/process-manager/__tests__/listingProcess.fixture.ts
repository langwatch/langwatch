/**
 * The state machinery both listing suites drive, in one place.
 *
 * The agents and people listing suites were built from identical copies of
 * this setup, which is how the two of them drifted: the envelope helper omitted
 * `requestId` in both, so every "committed without a request id" test was
 * exercising an absent key while production sends an explicit null. Two copies
 * meant two chances to notice and neither taken.
 *
 * The listing kind is a parameter here rather than a separate copy per suite,
 * because the point of these tests is that agents and people occupy separate
 * slots on ONE process and cannot collide. Fixtures that differ per kind would
 * be able to hide exactly the collision the suites exist to rule out.
 */

import { ingestionPullPM } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/pipeline";
import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
} from "~/server/event-sourcing/process-manager";
import { buildProcessDefinition } from "~/server/event-sourcing/process-manager/processRuntime";

import {
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
} from "../ingestionPullProcess.types";

/** Built through the pipeline's own applier, like the pull tests. */
export const definition = buildProcessDefinition(
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

export const ref = {
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
};

export const CONFIGURED_AT = Date.parse("2026-09-09T10:00:00Z");

/** The wake the cron in `bootConfigured` produces, named once. */
export const NEXT_PULL_AT = Date.parse("2026-09-09T10:15:00Z");

/** The timer key a listing of `kind` parks under, per request. */
export const listingKey = (kind: "agents" | "people", requestId: string) =>
  `process:${encodeURIComponent("source-1")}:${kind}:${requestId}`;

/**
 * Evolve is handed the content-boundary view, not the raw event data, so these
 * payloads are shaped like `buildProcessEventView` output: the fields a given
 * event does not carry arrive as null.
 *
 * `requestId` is in the defaults for that reason and not as tidiness. The view
 * builder writes `"requestId" in event.data ? … : null`, so the key is always
 * present on the way in. A fixture that omitted it made the no-request-id
 * tests turn on the schema treating absent and null alike, which is a
 * different claim than the one those tests mean to make.
 */
export function envelope({
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
    payload: {
      cron: null,
      cursor: null,
      runId: null,
      requestId: null,
      ...payload,
    },
  };
}

export function evolve({
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
export function bootConfigured() {
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

/**
 * A listing request for one kind, as the evolve arguments it produces.
 *
 * Returned as a builder rather than taking the event type at every call so a
 * suite names its kind once and cannot half-switch to the other one mid-file,
 * which would quietly turn a cross-slot independence test into a same-slot one.
 */
export function requestedFor(eventType: string) {
  return function requested({
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
        eventType,
        occurredAt: at,
        payload: { sourceId: "source-1", requestId },
      }),
      now: now ?? at,
    };
  };
}
