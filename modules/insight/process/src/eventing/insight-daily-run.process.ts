/**
 * The daily run's process, one instance per person and board. It keeps the schedule's wake armed
 * and turns a wake or an operator's request into one `runBoard` intent on the outbox, one run in
 * flight at a time. Pure handlers; every one re-derives the wake from the state.
 * @see modules/insight/adrs/004-daily-run.md
 */

import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessIntent,
  WakeHandler,
} from "@langwatch/eventing";
import {
  insightRunBoardSchema,
  insightRunHourSchema,
  insightRunMaxInsightsSchema,
  type InsightRunRequestedEventData,
  type InsightRunSettledEventData,
  type InsightScheduleConfiguredEventData,
  type InsightScheduleTurnedOffEventData,
} from "@langwatch/insight-contract";
import { z } from "zod";

import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import { isDueSlot, nextDailySlot } from "../rules/insight-daily-schedule.rules.ts";
import {
  INSIGHT_DAILY_RUN_INTENT,
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  type runBoardIntentSchema,
} from "./insight-daily-run.intent.ts";

export const INSIGHT_DAILY_RUN_PROCESS_NAME = "dailyInsightsSchedule" as const;

const scheduleSchema = z.object({
  userId: z.string(),
  board: insightRunBoardSchema,
  hour: insightRunHourSchema,
  timezone: z.string(),
  maxInsights: insightRunMaxInsightsSchema,
});

/** The schedule's fields came after the first instances, each with a default. */
export const insightDailyRunStateSchema = z.object({
  lastRequestId: z.string().nullable(),
  /** The run whose outcome is not recorded yet; `slot` is absent on an older instance. */
  pendingRun: z
    .object({ runId: z.string(), since: z.number(), slot: z.number().optional() })
    .nullable(),
  /** What the person chose, kept while the run is off; null until they turned it on once. */
  schedule: scheduleSchema.nullable().default(null),
  active: z.boolean().default(false),
  /** The slot of the last wake that ran: a schedule runs once per calendar date in its zone. */
  lastSlot: z.number().nullable().default(null),
});
export type InsightDailyRunState = z.infer<typeof insightDailyRunStateSchema>;

export const INITIAL_INSIGHT_DAILY_RUN_STATE: InsightDailyRunState = {
  lastRequestId: null,
  pendingRun: null,
  schedule: null,
  active: false,
  lastSlot: null,
};

/** A run that recorded no outcome within every attempt's lease is lost, and blocks no more. */
const PENDING_RUN_EXPIRY_MS = INSIGHT_DAILY_RUN_LEASE_MS * INSIGHT_DAILY_RUN_MAX_ATTEMPTS;

type InsightDailyRunIntents = {
  [INSIGHT_DAILY_RUN_INTENT]: IntentSpec<typeof runBoardIntentSchema>;
};
type Context = ProcessHandlerContext<InsightDailyRunIntents>;
type Handler<Data> = EventHandler<InsightDailyRunState, Data, InsightDailyRunIntents>;
type ScheduleRef = Pick<InsightRunRequestedEventData, "scheduleId" | "userId" | "board">;

/** Whether the event is this process's own: its schedule is the one its person and board derive. */
function isOwnSchedule(
  { scheduleId, userId, board }: ScheduleRef,
  { key, projectId }: { key: string; projectId: string },
): boolean {
  return key === scheduleId && isOwnScheduleId({ scheduleId, projectId, userId, board });
}

/** Arms the schedule's next slot from the state alone; a schedule that is off arms none. */
function settle({
  state,
  context,
  intents = [],
}: {
  state: InsightDailyRunState;
  context: Context;
  intents?: ProcessIntent[];
}): ProcessEvolution<InsightDailyRunState> {
  const { schedule, lastSlot } = state;
  if (!state.active || schedule === null) return { state, nextWakeAt: null, intents };
  const nextWakeAt = nextDailySlot({
    scheduleId: context.key,
    hour: schedule.hour,
    timezone: schedule.timezone,
    after: Math.max(context.at, context.now),
    lastSlot,
  });
  return { state, nextWakeAt, intents };
}

type RunToStart = Pick<
  z.input<typeof runBoardIntentSchema>,
  "runId" | "slot" | "userId" | "board" | "maxInsights"
>;
type Started = { state: InsightDailyRunState; intents: ProcessIntent[] };

/** One run at a time per person and board; a run that outlived every lease holds it no more. */
function isRunInFlight({ pendingRun }: InsightDailyRunState, context: Context): boolean {
  const now = Math.max(context.at, context.now);
  return pendingRun !== null && now - pendingRun.since < PENDING_RUN_EXPIRY_MS;
}

/**
 * The one way a run starts, for a wake and for a request alike: one `runBoard` intent. A run
 * still pending here outlived every lease, so the new run is handed it to record as lost.
 */
function startRun({
  state,
  context,
  run,
}: {
  state: InsightDailyRunState;
  context: Context;
  run: RunToStart;
}): Started {
  const lost = state.pendingRun;
  const since = Math.max(context.at, context.now);
  return {
    state: { ...state, pendingRun: { runId: run.runId, since, slot: run.slot } },
    intents: [
      context.intent(INSIGHT_DAILY_RUN_INTENT, `run:${run.runId}`, {
        scheduleId: context.key,
        ...run,
        ...(lost ? { supersedes: { runId: lost.runId, slot: lost.slot ?? lost.since } } : {}),
      }),
    ],
  };
}

/** Turning the run on, or changing it, arms the next slot from now: never a run at once. */
export const insightScheduleConfigured: Handler<InsightScheduleConfiguredEventData> = (
  state,
  data,
  context,
) => {
  if (!isOwnSchedule(data, context)) return settle({ state, context });
  const { userId, board, hour, timezone, maxInsights } = data;
  return settle({
    state: { ...state, schedule: { userId, board, hour, timezone, maxInsights }, active: true },
    context,
  });
};

/** Off cancels the wake. The last slot is kept, so on again the same day is not a second run. */
export const insightScheduleTurnedOff: Handler<InsightScheduleTurnedOffEventData> = (
  state,
  data,
  context,
) => settle({ state: isOwnSchedule(data, context) ? { ...state, active: false } : state, context });

/**
 * A reconcile pass found the row on with no wake armed. An instance that never took the
 * setting takes it now; one the person turned off since stays off.
 */
export const insightScheduleRearmRequested: Handler<InsightScheduleConfiguredEventData> = (
  state,
  data,
  context,
) =>
  state.schedule === null
    ? insightScheduleConfigured(state, data, context)
    : settle({ state, context });

/**
 * A request starts one run, unless it is a replay, a run for this board is in flight, or it
 * names a schedule that is not its own person's and board's.
 */
export const insightRunRequested: Handler<InsightRunRequestedEventData> = (
  state,
  data,
  context,
) => {
  const { userId, board, maxInsights, requestId } = data;
  const isTaken = isOwnSchedule(data, context) && state.lastRequestId !== requestId;
  if (!isTaken || isRunInFlight(state, context)) return settle({ state, context });
  // An operator's run is named by its request, so the request is the run's whole identity.
  const started = startRun({
    state: { ...state, lastRequestId: requestId },
    context,
    run: { runId: requestId, slot: context.at, userId, board, maxInsights },
  });
  return settle({ ...started, context });
};

/** The run's outcome is on the record, so another may start. */
export const insightRunSettled: Handler<InsightRunSettledEventData> = (state, data, context) => {
  const isSettled = isOwnSchedule(data, context) && state.pendingRun?.runId === data.runId;
  return settle({ state: isSettled ? { ...state, pendingRun: null } : state, context });
};

/**
 * The schedule's slot is due: one run for its calendar date, handed to the path a request
 * takes. A slot missed by hours, or one whose date already ran, starts nothing. A run still in
 * flight stands for the slot.
 */
export const insightScheduleWake: WakeHandler<InsightDailyRunState, InsightDailyRunIntents> = (
  state,
  context,
) => {
  const { schedule, lastSlot } = state;
  if (!state.active || schedule === null) return settle({ state, context });
  const slot = context.at;
  if (!isDueSlot({ slot, now: context.now, lastSlot, timezone: schedule.timezone })) {
    return settle({ state, context });
  }
  const { userId, board, maxInsights } = schedule;
  const run = { runId: `slot:${slot}`, slot, userId, board, maxInsights };
  const started: Started = isRunInFlight(state, context)
    ? { state, intents: [] }
    : startRun({ state, context, run });
  return settle({ ...started, state: { ...started.state, lastSlot: slot }, context });
};
