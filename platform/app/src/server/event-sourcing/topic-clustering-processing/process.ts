import { createHash } from "node:crypto";
import type {
  EvolveStep,
  HandlerContext,
  IntentDef,
  ProcessContext,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import {
  mintManualRunId,
  mintScheduledRunId,
  runIsNewer,
  runRank,
} from "./runIdentity";
import type {
  RequestedData,
  RunCompletedData,
  RunFailedData,
} from "./schema";
import { topicClusteringSearchAfterSchema } from "./schema";

/**
 * `topicClustering`: the per-project process manager owning the daily wake,
 * the run lifecycle, and the pagination cursor. One instance per project.
 *
 * Every step is a pure function of `(state, data, ctx)`; the durability comes
 * from the executor persisting state and dispatching intents at least once.
 */

export const TOPIC_CLUSTERING_PROCESS_NAME = "topicClustering" as const;

/**
 * A run that began this long ago is abandoned: the daily wake stops deferring
 * to it and a manual request may preempt it. Measured from the run id's own
 * embedded start instant, so there is no "last touched" stamp to keep in sync
 * — and a walk that starts near its slot and stalls for hours cannot look
 * fresh at the next one.
 */
export const TOPIC_CLUSTERING_STALE_RUN_MS = 20 * 60 * 60 * 1000;

export const topicClusteringRunIntentPayloadSchema = z.object({
  runId: z.string(),
  page: z.number(),
  /** Null for the first page; a continuation carries the previous page's cursor. */
  searchAfter: topicClusteringSearchAfterSchema.nullable(),
});
export type TopicClusteringRunIntentPayload = z.infer<
  typeof topicClusteringRunIntentPayloadSchema
>;

export type TopicClusteringIntents = {
  run: IntentDef<typeof topicClusteringRunIntentPayloadSchema>;
};

type Step = EvolveStep<TopicClusteringScheduleState, TopicClusteringIntents>;

export interface TopicClusteringScheduleState {
  /** The run this process believes owns the project, or `null` when idle.
   * Cleared by the run's final `runCompleted` or by a `runFailed`, and treated
   * as abandoned once {@link TOPIC_CLUSTERING_STALE_RUN_MS} has passed. */
  readonly currentRun: { readonly runId: string; readonly page: number } | null;
}

export const topicClusteringScheduleStateSchema: z.ZodType<TopicClusteringScheduleState> =
  z.object({
    currentRun: z.object({ runId: z.string(), page: z.number() }).nullable(),
  });

export function initTopicClusteringScheduleState(): TopicClusteringScheduleState {
  return { currentRun: null };
}

/** The project's stable minute of the UTC day, from a sha256 of its id.
 * `readUInt32BE` reads exactly 32 bits: reading the full hex digest through
 * `parseInt` overflows `Number.MAX_SAFE_INTEGER` and collapses every project
 * onto a handful of slots. */
function dailySlotOffsetMs(projectId: string): number {
  const digest = createHash("sha256").update(projectId).digest();
  return (digest.readUInt32BE(0) % (24 * 60)) * 60 * 1000;
}

/** The next occurrence of the project's daily slot strictly after `afterMs`. */
export function nextDailySlot(projectId: string, afterMs: number): number {
  const offset = dailySlotOffsetMs(projectId);
  const after = new Date(afterMs);
  const dayStart = Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate(),
  );
  const candidate = dayStart + offset;
  return candidate > afterMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/** An unrankable run id is never treated as stale purely for being
 * unrankable — a corrupt id must not let a second run pile on. */
function isRunInFlight(
  run: TopicClusteringScheduleState["currentRun"],
  refMs: number,
): boolean {
  if (run === null) return false;
  const startedAtMs = runRank(run.runId);
  if (startedAtMs === null) return true;
  return refMs - startedAtMs < TOPIC_CLUSTERING_STALE_RUN_MS;
}

/**
 * Clamps scheduling to the present. An event's `occurredAt` is business time,
 * so a backed-up subscriber can deliver one whose next slot has already passed,
 * and scheduling from it would arm a wake in the past.
 */
function schedulingRef(occurredAt: number, ctx: ProcessContext): number {
  return Math.max(occurredAt, ctx.now);
}

/** Every step reschedules the daily slot; the wake-time in-flight guard, not
 * wake suppression, is what prevents run pile-ups. */
function settle(
  state: TopicClusteringScheduleState,
  ctx: ProcessContext,
  refMs: number,
  intents: Step["intents"] = [],
): Step {
  return { state, intents, nextWakeAt: nextDailySlot(ctx.tenantId, refMs) };
}

function startRun(runId: string, ctx: ProcessContext, refMs: number): Step {
  return settle({ currentRun: { runId, page: 1 } }, ctx, refMs, [
    { type: "run", payload: { runId, page: 1, searchAfter: null } },
  ]);
}

/**
 * The wake step: starts the next scheduled run unless one is in flight.
 * A wake that fires late — the fleet was down for days — schedules from now,
 * not from the slot it missed; clustering re-derives its work from live
 * unassigned traces, so one catch-up run covers the whole gap.
 */
export function onTopicClusteringWake(
  state: TopicClusteringScheduleState,
  ctx: ProcessContext,
): Step {
  if (isRunInFlight(state.currentRun, ctx.now)) return settle(state, ctx, ctx.now);
  return startRun(mintScheduledRunId(ctx.now), ctx, ctx.now);
}

/** A manual ask preempts a merely-recorded (stale) run but defers to one
 * genuinely in flight; a bootstrap only ensures the schedule exists. The run id
 * is minted from business time, so a redelivered request mints the same id
 * rather than starting a second run. */
export function onClusteringRequested(
  state: TopicClusteringScheduleState,
  data: RequestedData,
  ctx: ProcessContext,
): Step {
  const refMs = schedulingRef(data.occurredAt, ctx);
  if (data.trigger !== "manual") return settle(state, ctx, refMs);
  if (isRunInFlight(state.currentRun, refMs)) return settle(state, ctx, refMs);
  return startRun(mintManualRunId(data.occurredAt), ctx, refMs);
}

/** Continues the walk if a cursor came back, otherwise clears the run. A
 * completion for a run a newer one has superseded is a late straggler. */
export function onClusteringRunCompleted(
  state: TopicClusteringScheduleState,
  data: RunCompletedData,
  ctx: ProcessContext,
): Step {
  const refMs = schedulingRef(data.occurredAt, ctx);
  if (
    state.currentRun !== null &&
    state.currentRun.runId !== data.runId &&
    !runIsNewer(data.runId, state.currentRun.runId)
  ) {
    return settle(state, ctx, refMs);
  }
  if (data.nextSearchAfter === undefined) {
    return settle({ currentRun: null }, ctx, refMs);
  }
  const page = data.page + 1;
  return settle({ currentRun: { runId: data.runId, page } }, ctx, refMs, [
    {
      type: "run",
      payload: {
        runId: data.runId,
        page,
        searchAfter: [data.nextSearchAfter[0], data.nextSearchAfter[1]],
      },
    },
  ]);
}

/** Mirror of the completion guard, so a late failure from a superseded run
 * cannot null out a newer one that has since started. */
export function onClusteringRunFailed(
  state: TopicClusteringScheduleState,
  data: RunFailedData,
  ctx: ProcessContext,
): Step {
  const refMs = schedulingRef(data.occurredAt, ctx);
  if (state.currentRun !== null && state.currentRun.runId !== data.runId) {
    return settle(state, ctx, refMs);
  }
  return settle({ currentRun: null }, ctx, refMs);
}

/**
 * What the `run` intent's delivery calls out to: one clustering page, start to
 * finish, including the outcome it records for itself.
 *
 * The whole effect is one port rather than the four primitives it decomposes
 * into, because its failure handling is attempt-dependent — below the retry cap
 * a clustering error rethrows so the outbox retries with backoff, and only the
 * final attempt records a durable `runFailed` — while the delivery context the
 * pipeline can see (`{ now, tenantId }`) carries no attempt number. Keeping the
 * split behind this port lets the composition root supply the deployed executor
 * unchanged instead of the pipeline approximating it.
 */
export interface TopicClusteringDispatchPorts {
  runClusteringPage(
    payload: TopicClusteringRunIntentPayload,
    ctx: HandlerContext,
  ): Promise<void>;
}

/** The mount record, with the one effect bound to the port that runs it. */
export function topicClusteringProcess(ports: TopicClusteringDispatchPorts) {
  return {
    state: topicClusteringScheduleStateSchema,
    init: initTopicClusteringScheduleState,
    intents: {
      run: {
        payload: topicClusteringRunIntentPayloadSchema,
        messageKey: (payload: TopicClusteringRunIntentPayload) =>
          `run:${payload.runId}:page-${payload.page}`,
        deliver: (
          payload: TopicClusteringRunIntentPayload,
          ctx: HandlerContext,
        ) => ports.runClusteringPage(payload, ctx),
      },
    },
    on: {
      requested: onClusteringRequested,
      runCompleted: onClusteringRunCompleted,
      runFailed: onClusteringRunFailed,
    },
    onWake: onTopicClusteringWake,
  };
}
