import crypto from "crypto";

import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import {
  topicClusteringProcessEventViewSchema,
  type topicClusteringRunIntentSchema,
  type TopicClusteringProcessEventView,
  type TopicClusteringProcessState,
} from "./topicClusteringProcess.types";

/**
 * The topic clustering process (ADR-051), authored for the ADR-052
 * `withProcessManager` builder: pure state logic only. The pipeline mounts
 * these handlers; the runtime owns the manager, outbox and wake workers.
 *
 * There is no `.schedule()` — the cadence is per-project (each project's
 * daily hash slot), so every handler returns its own explicit `nextWakeAt`.
 */

/**
 * A run that began this long ago is considered abandoned: the daily wake
 * stops deferring to it and starts a fresh run, and a manual request may
 * preempt it.
 *
 * Measured from the run's START, not its last page. Measuring from the last
 * page made this bound unenforceable: a backlog walk refreshes `updatedAtMs`
 * on every page, so a walk that starts at its slot and stalls five hours in
 * still looks fresh at the next slot, defers it, and only recovers a day
 * later — 48h of no clustering against a documented ≤24h. Sitting under the
 * 24h wake period is what makes "one lost completion event cannot block
 * scheduling for more than a day" actually true.
 */
export const TOPIC_CLUSTERING_STALE_RUN_MS = 20 * 60 * 60 * 1000;

/** The intents this process may emit; typed so handlers get `ctx.intents.run`. */
export type TopicClusteringIntents = {
  run: IntentSpec<typeof topicClusteringRunIntentSchema>;
};

type Ctx = ProcessHandlerContext<TopicClusteringIntents>;

export const INITIAL_TOPIC_CLUSTERING_STATE: TopicClusteringProcessState = {
  projectId: "",
  enabled: false,
  currentRun: null,
};

/**
 * Whether a run should still be treated as owning the project at `refMs`.
 * Rows written before `startedAtMs` existed fall back to `updatedAtMs`.
 */
function isRunInFlight(
  state: TopicClusteringProcessState,
  refMs: number,
): boolean {
  const run = state.currentRun;
  if (run === null) return false;
  const startedAtMs = run.startedAtMs ?? run.updatedAtMs;
  return refMs - startedAtMs < TOPIC_CLUSTERING_STALE_RUN_MS;
}

/**
 * The project's stable minute of the UTC day, derived from a sha256 of its
 * id (ADR-051 §"On wake").
 *
 * The legacy computation read the digest with `parseInt(hex, 16)` — 64 hex
 * digits, far past Number.MAX_SAFE_INTEGER — so it rounded to a multiple of
 * 2^203 and both `% 24` and `% 60` collapsed: the whole fleet landed in 15
 * slots at hours 00, 08 and 16. Taking one remainder over the day's 1440
 * minutes from 32 exact bits gives every minute, evenly.
 */
function dailySlotOffsetMs(projectId: string): number {
  const digest = crypto.createHash("sha256").update(projectId).digest();
  const minuteOfDay = digest.readUInt32BE(0) % (24 * 60);
  return minuteOfDay * 60 * 1000;
}

/** The next occurrence of the project's daily slot strictly after `afterMs`. */
export function nextDailySlot(projectId: string, afterMs: number): number {
  const offset = dailySlotOffsetMs(projectId);
  const dayStart = Date.UTC(
    new Date(afterMs).getUTCFullYear(),
    new Date(afterMs).getUTCMonth(),
    new Date(afterMs).getUTCDate(),
  );
  const candidate = dayStart + offset;
  return candidate > afterMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/**
 * `20260717T093000` — the scheduled run identity, from the instant the wake
 * actually started the run (second precision).
 *
 * The instant — not just the UTC date — must be part of the identity. Two
 * wakes CAN legitimately start runs on the same day: an outage that crosses
 * midnight makes the missed slot fire as a catch-up at recovery, finish, and
 * the day's real slot still arrives hours later. With a date-only id both
 * runs mint the same `run:<id>:page-1` messageKey, and the outbox's unique
 * index (status-independent, dispatched rows are not pruned) permanently
 * drops the second insert — leaving `currentRun` set with no intent in
 * flight: "Run now" no-ops behind the in-flight guard and the day's
 * clustering is lost. Second precision suffices because a new run can only
 * start after the previous one ended via a committed event, and the next
 * wake slot is always a strictly later minute boundary.
 */
function runIdForSlot(slotMs: number): string {
  return new Date(slotMs).toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/**
 * The content boundary (`toPayload`): narrows a committed pipeline event to
 * the identities-and-flags view the process is allowed to persist.
 * Clustering events carry no customer content, but the boundary keeps the
 * same shape discipline as other process managers.
 */
export function buildProcessEventView(
  event: TopicClusteringProcessingEvent,
): TopicClusteringProcessEventView {
  return {
    trigger: "trigger" in event.data ? event.data.trigger : null,
    runId: "runId" in event.data ? event.data.runId : null,
    page: "page" in event.data ? event.data.page : null,
    hasNextPage:
      "nextSearchAfter" in event.data && event.data.nextSearchAfter != null,
    nextSearchAfter:
      "nextSearchAfter" in event.data
        ? (event.data.nextSearchAfter ?? null)
        : null,
  };
}

function settle(
  state: TopicClusteringProcessState,
  refMs: number,
  intents?: ProcessEvolution<TopicClusteringProcessState>["intents"],
): ProcessEvolution<TopicClusteringProcessState> {
  // Every commit reschedules the daily slot; the wake-time in-flight guard
  // (not wake suppression) is what prevents run pile-ups.
  return {
    state,
    nextWakeAt:
      state.enabled && state.projectId
        ? nextDailySlot(state.projectId, refMs)
        : null,
    intents,
  };
}

/**
 * Whether an outcome event belongs to the run the process currently believes
 * is in flight. Outcomes are delivered at least once and can arrive long
 * after a stale-run recovery has moved on, so identity — not arrival order —
 * decides whether an outcome may touch `currentRun`.
 */
function isCurrentRun(
  state: TopicClusteringProcessState,
  runId: string,
): boolean {
  return state.currentRun?.runId === runId;
}

/**
 * Clamp the scheduling reference to the present. `ctx.at` is business time,
 * so a backed-up subscriber can deliver an event whose next daily slot has
 * ALREADY passed. Scheduling from it writes a nextWakeAt in the past; that
 * wake fires at once, regenerates a messageKey the outbox already
 * dispatched, and the duplicate insert is dropped — leaving `currentRun`
 * set with no intent in flight and a day of clustering silently skipped.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

function enabledBase(
  state: TopicClusteringProcessState,
  ctx: Ctx,
): TopicClusteringProcessState {
  return { ...state, projectId: ctx.key, enabled: true };
}

export const handleClusteringRequested: EventHandler<
  TopicClusteringProcessState,
  unknown,
  TopicClusteringIntents
> = (state, payload, ctx) => {
  const view = topicClusteringProcessEventViewSchema.parse(payload);
  const refMs = schedulingRef(ctx);
  const base = enabledBase(state, ctx);

  if (view.trigger !== "manual") {
    // Bootstrap: ensure the process exists and the first wake is set.
    return settle(base, refMs);
  }
  if (isRunInFlight(base, refMs)) {
    // A live run is walking the backlog; the projection shows it.
    return settle(base, refMs);
  }
  // A run that is merely RECORDED — stale, its effect long dead — must not
  // swallow the request. Deferring to it made "Run now" a silent no-op for
  // as long as the wedge lasted while the UI reported success, which is
  // exactly the state a user presses the button in.
  //
  // Identity comes from business time (`ctx.at`), never the clamped ref: a
  // redelivered request must mint the same runId, or it would start a
  // second run.
  const runId = `manual-${ctx.at}`;
  return settle(
    {
      ...base,
      currentRun: { runId, page: 1, updatedAtMs: refMs, startedAtMs: refMs },
    },
    refMs,
    [
      ctx.intents.run(`run:${runId}:page-1`, {
        runId,
        page: 1,
        searchAfter: null,
      }),
    ],
  );
};

export const handleClusteringRunCompleted: EventHandler<
  TopicClusteringProcessState,
  unknown,
  TopicClusteringIntents
> = (state, payload, ctx) => {
  const view = topicClusteringProcessEventViewSchema.parse(payload);
  const refMs = schedulingRef(ctx);
  const base = enabledBase(state, ctx);

  if (view.runId === null || view.page === null) {
    return settle(base, refMs);
  }
  if (!isCurrentRun(state, view.runId)) {
    // A late outcome from a superseded run. Acting on it would resurrect
    // the old run as `currentRun` and emit a continuation intent, so two
    // backlog walks would page the same project at once, each refreshing
    // the other's in-flight guard. The live run owns the project.
    return settle(base, refMs);
  }
  if (!view.hasNextPage) {
    return settle({ ...base, currentRun: null }, refMs);
  }
  const nextPage = view.page + 1;
  return settle(
    {
      ...base,
      currentRun: {
        runId: view.runId,
        page: nextPage,
        updatedAtMs: refMs,
        // Carry the original start forward. Restamping it per page would
        // make a walk immortal: every completed page would push the
        // stale-run deadline out and no wake could ever reclaim it.
        startedAtMs:
          state.currentRun?.startedAtMs ??
          state.currentRun?.updatedAtMs ??
          refMs,
      },
    },
    refMs,
    [
      ctx.intents.run(`run:${view.runId}:page-${nextPage}`, {
        runId: view.runId,
        page: nextPage,
        searchAfter: view.nextSearchAfter,
      }),
    ],
  );
};

export const handleClusteringRunFailed: EventHandler<
  TopicClusteringProcessState,
  unknown,
  TopicClusteringIntents
> = (state, payload, ctx) => {
  const view = topicClusteringProcessEventViewSchema.parse(payload);
  const refMs = schedulingRef(ctx);
  const base = enabledBase(state, ctx);

  if (view.runId !== null && !isCurrentRun(state, view.runId)) {
    // Mirror of the completion guard: a late failure from a superseded
    // run must not null out the LIVE run, or the next wake would start a
    // third run alongside the one still walking the backlog.
    return settle(base, refMs);
  }
  return settle({ ...base, currentRun: null }, refMs);
};

export const topicClusteringWake: WakeHandler<
  TopicClusteringProcessState,
  TopicClusteringIntents
> = (state, ctx) => {
  if (!state.enabled || !state.projectId) {
    // A wake for a process that was never bootstrapped decides nothing and
    // must clear itself, or the wake worker would re-find it forever.
    return { state, nextWakeAt: null, intents: [] };
  }

  // Clamp the reference instant to the present. A wake that fires late (the
  // fleet was down for days) must schedule the NEXT slot from now, not from
  // the slot it missed — otherwise every skipped day is replayed as its own
  // run within seconds of recovery. Clustering re-derives its work from live
  // unassigned traces, so one catch-up run covers the whole gap (ADR-051:
  // "a schedule gap after recovery self-heals").
  const refMs = schedulingRef(ctx);

  if (isRunInFlight(state, refMs)) {
    // An active backlog walk owns the project; skip this slot.
    return settle(state, refMs);
  }

  const runId = runIdForSlot(refMs);
  return settle(
    {
      ...state,
      currentRun: { runId, page: 1, updatedAtMs: refMs, startedAtMs: refMs },
    },
    refMs,
    [
      ctx.intents.run(`run:${runId}:page-1`, {
        runId,
        page: 1,
        searchAfter: null,
      }),
    ],
  );
};
