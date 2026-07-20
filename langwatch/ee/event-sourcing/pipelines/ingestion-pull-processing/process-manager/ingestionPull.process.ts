import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type {
  EventHandler,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { ProcessIntent } from "~/server/event-sourcing/process-manager";

import type { IngestionPullProcessingEvent } from "../schemas/events";
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

export function assertValidPullSchedule(cron: string): void {
  if (cron.trim().split(/\s+/).length !== 5) {
    throw new Error("pull schedule must be a five-field cron expression");
  }
  computeNextRunAt({ cron, timezone: "UTC", after: new Date() });
}

export function isValidPullSchedule(cron: string): boolean {
  try {
    assertValidPullSchedule(cron);
    return true;
  } catch {
    return false;
  }
}

function nextWake(cron: string, after: number): number {
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
  };
}

export const INITIAL_INGESTION_PULL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
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

function settle(
  state: IngestionPullProcessState,
  after: number,
  intents: ProcessIntent[] = [],
) {
  return {
    state,
    nextWakeAt:
      state.enabled && state.cron ? nextWake(state.cron, after) : null,
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
  return settle(
    {
      ...state,
      sourceId: view.sourceId,
      enabled: true,
      cron: view.cron,
      cursor: state.sourceId ? state.cursor : view.cursor,
    },
    schedulingRef(ctx),
  );
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
  return settle(
    {
      ...state,
      cursor: isCurrentRun ? view.cursor : state.cursor,
      currentRun: isCurrentRun ? null : state.currentRun,
    },
    schedulingRef(ctx),
  );
};

export const handlePullRunFailed: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  return settle(
    {
      ...state,
      currentRun:
        state.currentRun?.runId === view.runId ? null : state.currentRun,
    },
    schedulingRef(ctx),
  );
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
  if (active) return settle(state, ctx.now);

  // Identity comes from the slot the wake was scheduled for (`ctx.at`), never
  // the handling instant: a redelivered wake must mint the same runId, or it
  // would start a second pull over the same window.
  const runId = String(ctx.at);
  return settle(
    {
      ...state,
      currentRun: { runId, scheduledFor: ctx.at, startedAt: ctx.now },
    },
    ctx.now,
    [
      ctx.intents.run(`pull:${runId}`, {
        sourceId: state.sourceId,
        runId,
        scheduledFor: ctx.at,
        cursor: state.cursor,
      }),
    ],
  );
};
