import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type {
  EventHandler,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { ProcessIntent } from "~/server/event-sourcing/process-manager";

import {
  type IngestionPullProcessingEvent,
  isValidPullSchedule,
} from "../schemas/events";
import {
  type IngestionPullIntents,
  type IngestionPullProcessEventView,
  type IngestionPullProcessState,
  ingestionPullProcessEventViewSchema,
} from "./ingestionPullProcess.types";

/**
 * A run older than this no longer defers the next scheduled pull: its effect
 * is dead (the outbox lease plus retries are bounded well under it), so the
 * next wake abandons it and starts fresh from the durable cursor.
 */
export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1000;

/**
 * The same bound as a stale run, for the same reason (outbox lease times max
 * attempts is well under it), but named apart: a listing holds no cursor, so
 * abandoning one costs a duplicate provider call at worst and this number can
 * move on its own if that trade changes.
 */
export const INGESTION_PULL_STALE_LISTING_MS = INGESTION_PULL_STALE_RUN_MS;

function nextWake({ cron, after }: { cron: string; after: number }): number {
  return computeNextRunAt({
    cron,
    timezone: "UTC",
    after: new Date(after),
  }).getTime();
}

/**
 * The content boundary (ADR-052): narrows a committed pull event to the
 * identities and cursors the process may see.
 */
export function buildProcessEventView(
  event: IngestionPullProcessingEvent,
): IngestionPullProcessEventView {
  return {
    sourceId: event.data.sourceId,
    cron: "cron" in event.data ? event.data.cron : null,
    cursor:
      "cursor" in event.data
        ? event.data.cursor
        : "nextCursor" in event.data
          ? event.data.nextCursor
          : null,
    runId: "runId" in event.data ? event.data.runId : null,
    requestId: "requestId" in event.data ? event.data.requestId : null,
  };
}

export const INITIAL_INGESTION_PULL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
  currentAgentsListing: null,
};

type Ctx = ProcessHandlerContext<IngestionPullIntents>;

/**
 * Schedule from whichever is later: the event's business time or the instant
 * it is actually handled. An event replayed hours late would otherwise write
 * a nextWakeAt that is already in the past.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

function settle({
  state,
  after,
  intents = [],
}: {
  state: IngestionPullProcessState;
  after: number;
  intents?: ProcessIntent[];
}) {
  return {
    state,
    nextWakeAt:
      state.enabled && state.cron
        ? nextWake({ cron: state.cron, after })
        : null,
    intents,
  };
}

export const handlePullConfigured: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // The command boundary validates the cron; this guard is for events that
  // were committed anyway. Throwing here would poison the subscriber forever
  // (evolve re-runs the same committed event on every retry), so degrade
  // instead: keep the previous state and stand down until a valid
  // reconfiguration arrives.
  if (view.cron === null || !isValidPullSchedule(view.cron)) {
    return { state, nextWakeAt: null, intents: [] };
  }
  return settle({
    state: {
      ...state,
      sourceId: view.sourceId,
      enabled: true,
      cron: view.cron,
      cursor: state.sourceId ? state.cursor : view.cursor,
    },
    after: schedulingRef(ctx),
  });
};

export const handlePullDisabled: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  return {
    state: {
      ...state,
      sourceId: view.sourceId,
      enabled: false,
      cron: null,
      currentRun: null,
      currentAgentsListing: null,
    },
    nextWakeAt: null,
    intents: [],
  };
};

export const handlePullRunCompleted: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // Only the run this process is currently tracking may advance the durable
  // cursor. A late completion from a superseded run would otherwise regress
  // the live cursor and re-ingest its window.
  const isCurrentRun = state.currentRun?.runId === view.runId;
  return settle({
    state: {
      ...state,
      cursor: isCurrentRun ? view.cursor : state.cursor,
      currentRun: isCurrentRun ? null : state.currentRun,
    },
    after: schedulingRef(ctx),
  });
};

export const handlePullRunFailed: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  return settle({
    state: {
      ...state,
      currentRun:
        state.currentRun?.runId === view.runId ? null : state.currentRun,
    },
    after: schedulingRef(ctx),
  });
};

/**
 * Clears the listing this event is about, and leaves a listing it is not
 * about alone. Mirrors the `currentRun` guard: a late outcome from a
 * superseded request must not cancel the one actually in flight.
 */
function clearListing({
  state,
  requestId,
}: {
  state: IngestionPullProcessState;
  requestId: string | null;
}): IngestionPullProcessState {
  const isCurrent =
    requestId !== null && state.currentAgentsListing?.requestId === requestId;
  return {
    ...state,
    currentAgentsListing: isCurrent ? null : state.currentAgentsListing,
  };
}

/**
 * Turns one ask into one dispatched listing.
 *
 * Every arm settles through `settle`, so asking a source about its agents
 * never disturbs the pull schedule it is already keeping. That is the whole
 * reason this is not `handlePullConfigured`: that one settles the source to
 * its next cron tick, and an admin pressing a button is asking for now.
 */
export const handleAgentsListingRequested: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // Degrade rather than throw, like the configured handler: evolve re-runs a
  // committed event on every retry, so a malformed one would poison the
  // subscriber forever.
  if (view.requestId === null) {
    return settle({ state, after: schedulingRef(ctx) });
  }

  const inFlight = state.currentAgentsListing;
  const busy =
    inFlight != null &&
    inFlight.requestId !== view.requestId &&
    ctx.now - inFlight.startedAt < INGESTION_PULL_STALE_LISTING_MS;
  if (busy) {
    return settle({ state, after: schedulingRef(ctx) });
  }

  return settle({
    state: {
      ...state,
      sourceId: view.sourceId,
      currentAgentsListing: { requestId: view.requestId, startedAt: ctx.now },
    },
    after: schedulingRef(ctx),
    // Keyed on the request, so a redelivery of this event dispatches the same
    // intent rather than a second one.
    intents: [
      ctx.intents.listAgents(`agents:${view.requestId}`, {
        sourceId: view.sourceId,
        requestId: view.requestId,
        requestedAt: ctx.at,
      }),
    ],
  });
};

export const handleAgentsListed: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // The count lives in the event, not here: the process needs to know only
  // that the request is over. What the provider said is a fact for readers.
  return settle({
    state: clearListing({ state, requestId: view.requestId }),
    after: schedulingRef(ctx),
  });
};

export const handleAgentsListingRefused: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // A refusal frees the source for another attempt exactly like a success
  // does, and leaves the pull schedule untouched: a provider declining to
  // list its agents says nothing about whether it will serve transcripts.
  return settle({
    state: clearListing({ state, requestId: view.requestId }),
    after: schedulingRef(ctx),
  });
};

export const ingestionPullWake: WakeHandler<
  IngestionPullProcessState,
  IngestionPullIntents
> = (state, ctx) => {
  if (!state.enabled || !state.cron) {
    return { state, nextWakeAt: null, intents: [] };
  }

  const active =
    state.currentRun !== null &&
    ctx.now - state.currentRun.startedAt < INGESTION_PULL_STALE_RUN_MS;
  if (active) return settle({ state, after: ctx.now });

  // Identity comes from the slot the wake was scheduled for (`ctx.at`), never
  // the handling instant: a redelivered wake must mint the same runId, or it
  // would start a second pull over the same window.
  const runId = String(ctx.at);
  return settle({
    state: {
      ...state,
      currentRun: { runId, scheduledFor: ctx.at, startedAt: ctx.now },
    },
    after: ctx.now,
    intents: [
      ctx.intents.run(`pull:${runId}`, {
        sourceId: state.sourceId,
        runId,
        scheduledFor: ctx.at,
        cursor: state.cursor,
      }),
    ],
  });
};
