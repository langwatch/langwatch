import { createHash } from "node:crypto";
import type { EvolveWakeFn, IntentUnion } from "@langwatch/event-sourcing";
import { defineProcess } from "@langwatch/event-sourcing";
import { z } from "zod";
import type { ClusteringPageOutcome } from "~/server/app-layer/topic-clustering/clustering";
import { topicClustering } from "./aggregate";
import {
  mintManualRunId,
  mintScheduledRunId,
  runIsNewer,
  runRank,
} from "./runIdentity";
import type { RunCompletedData, RunFailedData, RunStartedData } from "./schema";
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

const topicClusteringIntents = {
  run: {
    payload: topicClusteringRunIntentPayloadSchema,
    messageKey: (payload: TopicClusteringRunIntentPayload) =>
      `run:${payload.runId}:page-${payload.page}`,
  },
};
type TopicClusteringIntents = typeof topicClusteringIntents;

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

/** Clamps scheduling to the present. `ctx.at` is business time, so a backed-up
 * subscriber can deliver an event whose next slot has already passed, and
 * scheduling from it would arm a wake in the past. */
function schedulingRef(ctx: { at: number; now: number }): number {
  return Math.max(ctx.at, ctx.now);
}

/** Every step reschedules the daily slot; the wake-time in-flight guard, not
 * wake suppression, is what prevents run pile-ups. */
function settle(
  state: TopicClusteringScheduleState,
  ctx: { tenantId: string; at: number; now: number },
  intents: readonly IntentUnion<
    typeof TOPIC_CLUSTERING_PROCESS_NAME,
    TopicClusteringIntents
  >[] = [],
) {
  return {
    state,
    intents,
    nextWakeAt: nextDailySlot(ctx.tenantId, schedulingRef(ctx)),
  };
}

/**
 * The wake step: starts the next scheduled run unless one is in flight.
 * A wake that fires late — the fleet was down for days — schedules from now,
 * not from the slot it missed; clustering re-derives its work from live
 * unassigned traces, so one catch-up run covers the whole gap.
 */
export const onTopicClusteringWake: EvolveWakeFn<
  TopicClusteringScheduleState,
  typeof TOPIC_CLUSTERING_PROCESS_NAME,
  TopicClusteringIntents
> = (state, intents, ctx) => {
  if (isRunInFlight(state.currentRun, schedulingRef(ctx))) {
    return settle(state, ctx);
  }
  const runId = mintScheduledRunId(schedulingRef(ctx));
  return settle({ currentRun: { runId, page: 1 } }, ctx, [
    intents.run({ runId, page: 1, searchAfter: null }),
  ]);
};

export const topicClusteringProcess = defineProcess(
  TOPIC_CLUSTERING_PROCESS_NAME,
)
  .state(topicClusteringScheduleStateSchema, initTopicClusteringScheduleState)
  .intents(topicClusteringIntents)
  .on(topicClustering)
  .onEvents({
    /** A manual ask preempts a merely-recorded (stale) run but defers to one
     * genuinely in flight; a bootstrap only ensures the schedule exists.
     * The run id is minted from business time, so a redelivered request mints
     * the same id rather than starting a second run. */
    requested: (state, data, intents, ctx) => {
      if (data.trigger !== "manual") return settle(state, ctx);
      if (isRunInFlight(state.currentRun, schedulingRef(ctx))) {
        return settle(state, ctx);
      }
      const runId = mintManualRunId(ctx.at);
      return settle({ currentRun: { runId, page: 1 } }, ctx, [
        intents.run({ runId, page: 1, searchAfter: null }),
      ]);
    },

    /** Continues the walk if a cursor came back, otherwise clears the run. A
     * completion for a run a newer one has superseded is a late straggler. */
    runCompleted: (state, data, intents, ctx) => {
      if (
        state.currentRun !== null &&
        state.currentRun.runId !== data.runId &&
        !runIsNewer(data.runId, state.currentRun.runId)
      ) {
        return settle(state, ctx);
      }
      if (data.nextSearchAfter === undefined) {
        return settle({ currentRun: null }, ctx);
      }
      const page = data.page + 1;
      return settle({ currentRun: { runId: data.runId, page } }, ctx, [
        intents.run({
          runId: data.runId,
          page,
          searchAfter: [data.nextSearchAfter[0], data.nextSearchAfter[1]],
        }),
      ]);
    },

    /** Mirror of the completion guard, so a late failure from a superseded run
     * cannot null out a newer one that has since started. */
    runFailed: (state, data, _intents, ctx) => {
      if (state.currentRun !== null && state.currentRun.runId !== data.runId) {
        return settle(state, ctx);
      }
      return settle({ currentRun: null }, ctx);
    },
  })
  .onWake(onTopicClusteringWake)
  .build();

/**
 * What the `run` intent's handler calls out to: the clustering algorithm, and
 * this pipeline's own commands for reporting the outcome. Neither is an
 * event-sourcing concern, so this interface is the seam the composition root
 * adapts. Every argument shape is the declared payload, never a parallel
 * hand-written struct.
 */
export interface TopicClusteringDispatchPorts {
  runClusteringPage(
    params: Pick<
      TopicClusteringRunIntentPayload,
      "runId" | "page" | "searchAfter"
    > & { projectId: string },
  ): Promise<ClusteringPageOutcome>;
  recordClusteringRunStarted(params: RunStartedData): Promise<void>;
  recordClusteringRunCompleted(params: RunCompletedData): Promise<void>;
  recordClusteringRunFailed(params: RunFailedData): Promise<void>;
}
