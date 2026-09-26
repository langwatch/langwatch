import type {
  ReportRunRequestedEventData,
  ReportRunSettledEventData,
  ReportScheduleConfiguredEventData,
  ReportScheduleTargetEventData,
} from "@langwatch/automation-contract";
import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessIntent,
  WakeHandler,
} from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";
import { Cron } from "croner";

import type { reportDispatchIntentSchema } from "./report-schedule.intent.ts";

export const REPORT_SCHEDULE_PROCESS_NAME = "reportSchedule" as const;

export type ReportScheduleState = {
  triggerId: string;
  cron: string | null;
  timezone: string | null;
  active: boolean;
  lastSlot: number | null;
  lastRunRequestId: string | null;
  /** A run-now whose dispatch is neither sent nor finally failed; absent on pre-guard instances. */
  pendingRun?: { requestId: string; slot: number } | null;
};

export const INITIAL_REPORT_SCHEDULE_STATE: ReportScheduleState = {
  triggerId: "",
  cron: null,
  timezone: null,
  active: false,
  lastSlot: null,
  lastRunRequestId: null,
  pendingRun: null,
};

/** The report's first run strictly after `after`, in its own timezone. */
function nextReportRunAt({
  cron,
  timezone,
  after,
}: {
  cron: string;
  timezone: string;
  after: number;
}): number {
  const from = toDate(Temporal.Instant.fromEpochMilliseconds(after));
  const next = new Cron(cron, { timezone }).nextRun(from);
  if (!next) {
    throw new Error(`No report run exists after ${from.toISOString()}`);
  }
  return next.getTime();
}

type ReportScheduleIntents = {
  dispatchReport: IntentSpec<typeof reportDispatchIntentSchema>;
};
type Handler<Data> = EventHandler<ReportScheduleState, Data, ReportScheduleIntents>;

/** Arms the next cron slot from the state alone, so every transition re-derives the same wake. */
function settle({
  state,
  after,
  intents = [],
}: {
  state: ReportScheduleState;
  after: number;
  intents?: ProcessIntent[];
}): ProcessEvolution<ReportScheduleState> {
  if (!state.active || !state.cron || !state.timezone) {
    return { state, nextWakeAt: null, intents };
  }
  const nextWakeAt = nextReportRunAt({ cron: state.cron, timezone: state.timezone, after });
  return { state, nextWakeAt, intents };
}

export const reportScheduleConfigured: Handler<ReportScheduleConfiguredEventData> = (
  state,
  data,
  context,
) =>
  settle({
    state: {
      ...state,
      triggerId: data.triggerId,
      cron: data.cron,
      timezone: data.timezone,
      active: true,
    },
    after: Math.max(context.at, context.now),
  });

/** Saving any non-report automation pauses; one never configured stays without an instance row. */
export const reportSchedulePaused: Handler<ReportScheduleTargetEventData> = (state, data) => ({
  state: state.cron === null ? state : { ...state, triggerId: data.triggerId, active: false },
  nextWakeAt: null,
  intents: [],
});

export const reportScheduleResumed: Handler<ReportScheduleTargetEventData> = (
  state,
  data,
  context,
) =>
  settle({
    state: { ...state, triggerId: data.triggerId, active: state.cron !== null },
    after: Math.max(context.at, context.now),
  });

/** Main's run-now made the slot due at once and refused while a run was in flight. */
export const reportRunRequested: Handler<ReportRunRequestedEventData> = (state, data, context) => {
  const after = Math.max(context.at, context.now);
  if (!state.active || state.lastRunRequestId === data.requestId || state.pendingRun) {
    return settle({ state, after });
  }
  return settle({
    state: {
      ...state,
      lastSlot: context.at,
      lastRunRequestId: data.requestId,
      pendingRun: { requestId: data.requestId, slot: context.at },
    },
    after,
    intents: [
      context.intents.dispatchReport(`run:${data.requestId}`, {
        triggerId: data.triggerId,
        slot: context.at,
        requestId: data.requestId,
      }),
    ],
  });
};

/** The run-now's dispatch was sent or finally failed, so another may be asked for. */
export const reportRunSettled: Handler<ReportRunSettledEventData> = (state, data, context) =>
  settle({
    state: state.pendingRun?.requestId === data.requestId ? { ...state, pendingRun: null } : state,
    after: Math.max(context.at, context.now),
  });

/** A down fleet fires the missed slot once; a scheduled send supersedes an unsettled run-now. */
export const reportScheduleWake: WakeHandler<ReportScheduleState, ReportScheduleIntents> = (
  state,
  context,
) => {
  if (!state.active || !state.cron) {
    return { state, nextWakeAt: null, intents: [] };
  }
  return settle({
    state: { ...state, lastSlot: context.at, pendingRun: null },
    after: Math.max(context.at, context.now),
    intents: [
      context.intents.dispatchReport(`report:${context.at}`, {
        triggerId: state.triggerId,
        slot: context.at,
      }),
    ],
  });
};
