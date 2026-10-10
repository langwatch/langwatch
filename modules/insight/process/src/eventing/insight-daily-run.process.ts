/**
 * The daily run's process, one instance per person and board: it turns a request into one
 * `runBoard` intent on the outbox and lets one run be in flight at a time. Pure handlers.
 * @see modules/insight/adrs/004-daily-run.md
 */

import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import type {
  InsightRunRequestedEventData,
  InsightRunSettledEventData,
} from "@langwatch/insight-contract";
import { z } from "zod";

import { isOwnScheduleId } from "../rules/insight-daily-run.rules.ts";
import {
  INSIGHT_DAILY_RUN_INTENT,
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  type runBoardIntentSchema,
} from "./insight-daily-run.intent.ts";

export const INSIGHT_DAILY_RUN_PROCESS_NAME = "dailyInsightsSchedule" as const;

export const insightDailyRunStateSchema = z.object({
  lastRequestId: z.string().nullable(),
  /** The run whose outcome is not recorded yet. */
  pendingRun: z.object({ runId: z.string(), since: z.number() }).nullable(),
});
export type InsightDailyRunState = z.infer<typeof insightDailyRunStateSchema>;

export const INITIAL_INSIGHT_DAILY_RUN_STATE: InsightDailyRunState = {
  lastRequestId: null,
  pendingRun: null,
};

/** A run that recorded no outcome within every attempt's lease is lost, and blocks no more. */
const PENDING_RUN_EXPIRY_MS = INSIGHT_DAILY_RUN_LEASE_MS * INSIGHT_DAILY_RUN_MAX_ATTEMPTS;

type InsightDailyRunIntents = {
  [INSIGHT_DAILY_RUN_INTENT]: IntentSpec<typeof runBoardIntentSchema>;
};
type Handler<Data> = EventHandler<InsightDailyRunState, Data, InsightDailyRunIntents>;

/** Whether the event is this process's own: its schedule is the one its person and board derive. */
function isOwnSchedule(
  {
    scheduleId,
    userId,
    board,
  }: Pick<InsightRunRequestedEventData, "scheduleId" | "userId" | "board">,
  { key, projectId }: { key: string; projectId: string },
): boolean {
  return key === scheduleId && isOwnScheduleId({ scheduleId, projectId, userId, board });
}

/**
 * A request starts one run, unless it is a replay, a run for this board is in flight, or it
 * names a schedule that is not its own person's and board's.
 */
export const insightRunRequested: Handler<InsightRunRequestedEventData> = (
  state,
  data,
  context,
) => {
  if (!isOwnSchedule(data, context)) return { state, intents: [] };
  const now = Math.max(context.at, context.now);
  const inFlight =
    state.pendingRun !== null && now - state.pendingRun.since < PENDING_RUN_EXPIRY_MS;
  if (state.lastRequestId === data.requestId || inFlight) return { state, intents: [] };
  // An operator's run is named by its request, so the request is the run's whole identity.
  const runId = data.requestId;
  return {
    state: { lastRequestId: data.requestId, pendingRun: { runId, since: now } },
    intents: [
      context.intent(INSIGHT_DAILY_RUN_INTENT, `run:${runId}`, {
        scheduleId: data.scheduleId,
        userId: data.userId,
        board: data.board,
        maxInsights: data.maxInsights,
        runId,
        slot: context.at,
      }),
    ],
  };
};

/** The run's outcome is on the record, so another may start. */
export const insightRunSettled: Handler<InsightRunSettledEventData> = (state, data, context) => {
  const isSettled = isOwnSchedule(data, context) && state.pendingRun?.runId === data.runId;
  return { state: isSettled ? { ...state, pendingRun: null } : state, intents: [] };
};
