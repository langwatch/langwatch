import type {
  EvolveStep,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";

import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";

import {
  type ingestionPullEvents,
  isValidPullSchedule,
} from "../schemas/events";
import type { IngestionPullIntents } from "./ingestionPullEffects";
import type { IngestionPullProcessState } from "./ingestionPullProcess.types";

/**
 * A run older than this no longer defers the next scheduled pull: its effect
 * is dead (the outbox lease plus retries are bounded well under it), so the
 * next wake abandons it and starts fresh from the durable cursor.
 */
export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1000;

type Step = EvolveStep<IngestionPullProcessState, IngestionPullIntents>;

function nextWake({ cron, after }: { cron: string; after: number }): number {
  return computeNextRunAt({
    cron,
    timezone: "UTC",
    after: new Date(after),
  }).getTime();
}

/**
 * Schedule from whichever is later: the event's business time or the instant
 * it is actually handled. An event replayed hours late would otherwise write
 * a nextWakeAt that is already in the past.
 */
function schedulingRef(occurredAt: number, ctx: ProcessContext): number {
  return Math.max(occurredAt, ctx.now);
}

function settle(args: {
  state: IngestionPullProcessState;
  after: number;
  intents?: Step["intents"];
}): Step {
  const { state, after, intents = [] } = args;
  return {
    state,
    nextWakeAt:
      state.enabled && state.cron
        ? nextWake({ cron: state.cron, after })
        : null,
    intents,
  };
}

const stood = (state: IngestionPullProcessState): Step => ({
  state,
  nextWakeAt: null,
  intents: [],
});

export const ingestionPullOn: ProcessManagerHandlerMap<
  typeof ingestionPullEvents,
  IngestionPullProcessState,
  IngestionPullIntents
> = {
  configured(state, data, ctx) {
    // The command boundary validates the cron; this guard is for events that
    // were committed anyway. Throwing here would poison the process forever
    // (evolve re-runs the same committed event on every retry), so degrade
    // instead: keep the previous state and stand down until a valid
    // reconfiguration arrives.
    if (!isValidPullSchedule(data.cron)) return stood(state);
    return settle({
      state: {
        ...state,
        sourceId: data.sourceId,
        enabled: true,
        cron: data.cron,
        cursor: state.sourceId ? state.cursor : data.cursor,
      },
      after: schedulingRef(data.occurredAt, ctx),
    });
  },

  disabled(state, data) {
    return stood({
      ...state,
      sourceId: data.sourceId,
      enabled: false,
      cron: null,
      currentRun: null,
    });
  },

  runCompleted(state, data, ctx) {
    // Only the run this process is currently tracking may advance the durable
    // cursor. A late completion from a superseded run would otherwise regress
    // the live cursor and re-ingest its window.
    const isCurrentRun = state.currentRun?.runId === data.runId;
    return settle({
      state: {
        ...state,
        cursor: isCurrentRun ? data.nextCursor : state.cursor,
        currentRun: isCurrentRun ? null : state.currentRun,
      },
      after: schedulingRef(data.occurredAt, ctx),
    });
  },

  runFailed(state, data, ctx) {
    return settle({
      state: {
        ...state,
        currentRun:
          state.currentRun?.runId === data.runId ? null : state.currentRun,
      },
      after: schedulingRef(data.occurredAt, ctx),
    });
  },
};

/**
 * The run's identity is the instant the wake ran: `ProcessContext` carries no
 * slot the deadline was armed for, and `now` is monotonic across an instance's
 * wakes, which is what both the stale-run check and the read model's
 * supersession fence need.
 */
export function ingestionPullOnWake(
  state: IngestionPullProcessState,
  ctx: ProcessContext,
): Step {
  if (!state.enabled || !state.cron) return stood(state);

  const active =
    state.currentRun !== null &&
    ctx.now - state.currentRun.startedAt < INGESTION_PULL_STALE_RUN_MS;
  if (active) return settle({ state, after: ctx.now });

  const runId = String(ctx.now);
  return settle({
    state: {
      ...state,
      currentRun: { runId, scheduledFor: ctx.now, startedAt: ctx.now },
    },
    after: ctx.now,
    intents: [
      {
        type: "run",
        payload: {
          sourceId: state.sourceId,
          runId,
          scheduledFor: ctx.now,
          cursor: state.cursor,
        },
      },
    ],
  });
}
