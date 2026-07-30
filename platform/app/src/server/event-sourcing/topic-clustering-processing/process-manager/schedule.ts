import { createHash } from "node:crypto";
import { z } from "zod";
import {
  defineProcessManager,
  type EventStep,
  type IntentUnion,
  type StepResult,
  type WakeStep,
} from "../../automations/process-managers/defineProcessManager";
import {
  mintManualRunId,
  mintScheduledRunId,
  runIsNewer,
  runRank,
} from "../runIdentity";
import { topicClusteringSearchAfterSchema } from "../schema";

/**
 * `topicClustering`: the durable, per-project process manager that owns the
 * daily wake-up, the run lifecycle, and the pagination cursor (ADR-098
 * decision 1). One instance per project (`groupKey.ts`'s `scope: aggregate`
 * mirroring the `topic_clustering` aggregate 1:1).
 *
 * Built on `defineProcessManager` (`../../automations/process-managers/defineProcessManager.ts`)
 * rather than a fresh, per-pipeline declaration of the same shape — that
 * builder is `@langwatch/event-sourcing`'s missing `defineProcess` stand-in
 * (its own docblock: "the local stand-in for the DECLARATION half of that
 * gap"), and this pipeline's process needs exactly the same StepResult/
 * wake/intent-envelope contract `triggerSettlement.ts` already uses.
 * Re-declaring `StepResult`/`WakeStep`/an intent-type constant map here
 * would be a second copy of a type that already has one home.
 *
 * There is no `.schedule()` here (the fixed-interval, singleton shape
 * `graphAlertSweep`/`webhookDeliveryPrune` use) — this process uses
 * `.events({...}).onWake(...)`: the cadence is each project's own daily
 * hash slot ({@link dailySlotOffsetMs}), so every step returns its own
 * explicit `nextWakeAt` rather than a fixed interval.
 *
 * Everything below is a pure function of `(state, data, ctx)`, same as
 * `triggerSettlement.ts` — the durability comes from the (not yet built)
 * executor persisting state and dispatching intents at-least-once, not from
 * anything in this file.
 */

export const TOPIC_CLUSTERING_PROCESS_NAME = "topicClustering" as const;

/**
 * A run that began this long ago is considered abandoned: the daily wake
 * stops deferring to it and starts a fresh run, and a manual request may
 * preempt it. Measured from the run's own minted instant ({@link runRank}
 * via {@link isRunInFlight}) rather than a separately-tracked,
 * event-refreshed "last touched" timestamp — the old process tracked
 * `updatedAtMs` for this and had to add a SECOND field, `startedAtMs`, once
 * it discovered that refreshing staleness from the last page made the bound
 * unenforceable (a walk that starts near its slot and stalls for hours
 * still looked fresh at the next slot). Deriving staleness from the run
 * id's own embedded start instant gets that fix for free, with nothing to
 * keep in sync, because the id itself never moves.
 */
export const TOPIC_CLUSTERING_STALE_RUN_MS = 20 * 60 * 60 * 1000;

export const topicClusteringRunIntentPayloadSchema = z.object({
  runId: z.string(),
  page: z.number(),
  /** Null for the first page; a continuation intent carries the cursor the
   * previous page returned. */
  searchAfter: topicClusteringSearchAfterSchema.nullable(),
});
export type TopicClusteringRunIntentPayload = z.infer<
  typeof topicClusteringRunIntentPayloadSchema
>;

/** The process's one declared intent. `.intents()` is both the runtime
 * payload validator and the source of the typed `ctx.intents.run(...)`
 * constructor — there is no second, hand-maintained intent-type constant to
 * keep in sync with this key. */
export const topicClusteringIntentSchemas = {
  run: topicClusteringRunIntentPayloadSchema,
};
type Intents = typeof topicClusteringIntentSchemas;

export interface TopicClusteringScheduleState {
  /** The run this process currently believes owns the project, or `null`
   * when idle. Guards a wake or manual request from piling a second run
   * onto an active backlog walk. Cleared by the run's final `runCompleted`
   * (no continuation cursor) or a `runFailed`, or treated as abandoned once
   * {@link isRunInFlight} says so. */
  readonly currentRun: { readonly runId: string; readonly page: number } | null;
}

export const topicClusteringScheduleStateSchema: z.ZodType<TopicClusteringScheduleState> =
  z.object({
    currentRun: z.object({ runId: z.string(), page: z.number() }).nullable(),
  });

export function initTopicClusteringScheduleState(): TopicClusteringScheduleState {
  return { currentRun: null };
}

/**
 * The project's stable minute of the UTC day, derived from a sha256 of its
 * id. `readUInt32BE` reads exactly 32 bits before the `%` — the historical
 * bug this replaces (`event-sourcing.old`) read the full hex digest with
 * `parseInt(hex, 16)`, far past `Number.MAX_SAFE_INTEGER`, which rounds to a
 * multiple of a large power of two and collapses both `% 24` and `% 60`
 * onto a handful of slots. This rewrite reproduces the CURRENT, already-
 * fixed computation, not the historical bug.
 */
function dailySlotOffsetMs(projectId: string): number {
  const digest = createHash("sha256").update(projectId).digest();
  const minuteOfDay = digest.readUInt32BE(0) % (24 * 60);
  return minuteOfDay * 60 * 1000;
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

/** Whether `run` should still be treated as owning the project at `refMs`,
 * derived from the run id's own minted instant (see the module docblock's
 * `TOPIC_CLUSTERING_STALE_RUN_MS` note). An unrankable run id (`runRank`
 * returns `null`) is never treated as stale purely by that — a corrupt or
 * foreign-shaped id must not silently let a second run pile on. */
function isRunInFlight(
  run: TopicClusteringScheduleState["currentRun"],
  refMs: number,
): boolean {
  if (run === null) return false;
  const startedAtMs = runRank(run.runId);
  if (startedAtMs === null) return true;
  return refMs - startedAtMs < TOPIC_CLUSTERING_STALE_RUN_MS;
}

/** Clamps the scheduling reference to the present. `ctx.at` is business
 * time, so a backed-up subscriber can deliver an event whose next daily
 * slot has ALREADY passed; scheduling from it would write a `nextWakeAt` in
 * the past that fires immediately and regenerates an already-dispatched
 * messageKey. */
function schedulingRef(ctx: { at: number; now: number }): number {
  return Math.max(ctx.at, ctx.now);
}

/** Every step reschedules the daily slot; the wake-time in-flight guard —
 * not wake suppression — is what prevents run pile-ups. */
function settle(
  state: TopicClusteringScheduleState,
  projectId: string,
  refMs: number,
  intents?: readonly IntentUnion<Intents>[],
): StepResult<TopicClusteringScheduleState, Intents> {
  return { state, nextWakeAt: nextDailySlot(projectId, refMs), intents };
}

interface RequestedData {
  trigger: "manual" | "bootstrap";
  occurredAt: number;
}

/** `requested`: a manual ask preempts a merely-RECORDED (stale) run, but
 * defers to one that is genuinely still in flight. A bootstrap request only
 * ensures the process exists and its first wake is set — clustering itself
 * is wake-driven, never emitted from a bootstrap. Identity comes from
 * business time (`ctx.at`), never the clamped scheduling ref: a redelivered
 * request must mint the SAME runId (`mintManualRunId`), or it would start a
 * second run for what the outbox/command bus sees as one logical ask. */
export const evolveRequested: EventStep<
  TopicClusteringScheduleState,
  RequestedData,
  Intents
> = (state, data, ctx) => {
  const refMs = schedulingRef(ctx);

  if (data.trigger !== "manual") {
    return settle(state, ctx.key, refMs);
  }
  if (isRunInFlight(state.currentRun, refMs)) {
    return settle(state, ctx.key, refMs);
  }

  const runId = mintManualRunId(ctx.at);
  return settle({ currentRun: { runId, page: 1 } }, ctx.key, refMs, [
    ctx.intents.run(`run:${runId}:page-1`, {
      runId,
      page: 1,
      searchAfter: null,
    }),
  ]);
};

interface RunCompletedData {
  runId: string;
  page: number;
  nextSearchAfter?: readonly [number, string];
}

/** `runCompleted`: continues the walk if a cursor was returned, otherwise
 * clears `currentRun`. A completion for a run the process no longer
 * recognises as current — because a newer run has since superseded it — is
 * a late straggler and is dropped, the same rank-based guard `runStatus.ts`
 * uses, so a stale continuation can never resurrect an old run alongside a
 * genuinely newer one already walking the backlog. */
export const evolveRunCompleted: EventStep<
  TopicClusteringScheduleState,
  RunCompletedData,
  Intents
> = (state, data, ctx) => {
  const refMs = schedulingRef(ctx);

  if (state.currentRun !== null && state.currentRun.runId !== data.runId) {
    // Not the run this process currently tracks. Accept it only if it is
    // rank-newer (a legitimate new run this process has not yet observed
    // the start of); otherwise it is a stale straggler from a superseded run.
    if (!runIsNewer(data.runId, state.currentRun.runId)) {
      return settle(state, ctx.key, refMs);
    }
  }

  if (data.nextSearchAfter === undefined) {
    return settle({ currentRun: null }, ctx.key, refMs);
  }

  const nextPage = data.page + 1;
  return settle(
    { currentRun: { runId: data.runId, page: nextPage } },
    ctx.key,
    refMs,
    [
      ctx.intents.run(`run:${data.runId}:page-${nextPage}`, {
        runId: data.runId,
        page: nextPage,
        searchAfter: [data.nextSearchAfter[0], data.nextSearchAfter[1]] as [
          number,
          string,
        ],
      }),
    ],
  );
};

interface RunFailedData {
  runId: string;
}

/** `runFailed`: clears `currentRun` unless the failure belongs to a run
 * this process no longer tracks as current — mirror of the completion
 * guard, so a late failure from a superseded run cannot null out a
 * genuinely newer run that has since started. */
export const evolveRunFailed: EventStep<
  TopicClusteringScheduleState,
  RunFailedData,
  Intents
> = (state, data, ctx) => {
  const refMs = schedulingRef(ctx);
  if (state.currentRun !== null && state.currentRun.runId !== data.runId) {
    return settle(state, ctx.key, refMs);
  }
  return settle({ currentRun: null }, ctx.key, refMs);
};

/**
 * The wake step: starts the next scheduled run unless one is already in
 * flight. `ctx.at` is clamped to the present (`schedulingRef`) so a wake
 * that fires late — the fleet was down for days — schedules the NEXT slot
 * from now, not from the slot it missed; clustering re-derives its work
 * from live unassigned traces, so one catch-up run covers the whole gap.
 */
export const onTopicClusteringWake: WakeStep<
  TopicClusteringScheduleState,
  Intents
> = (state, ctx) => {
  const refMs = schedulingRef(ctx);
  if (isRunInFlight(state.currentRun, refMs)) {
    return settle(state, ctx.key, refMs);
  }

  const runId = mintScheduledRunId(refMs);
  return settle({ currentRun: { runId, page: 1 } }, ctx.key, refMs, [
    ctx.intents.run(`run:${runId}:page-1`, {
      runId,
      page: 1,
      searchAfter: null,
    }),
  ]);
};

/** The one declaration — see the module docblock for why this is built on
 * `defineProcessManager` rather than a fresh per-pipeline shape. */
export const topicClusteringProcessDefinition = defineProcessManager(
  TOPIC_CLUSTERING_PROCESS_NAME,
)
  .state(topicClusteringScheduleStateSchema, initTopicClusteringScheduleState)
  .intents(topicClusteringIntentSchemas)
  .events({
    requested: evolveRequested,
    runCompleted: evolveRunCompleted,
    runFailed: evolveRunFailed,
  })
  .onWake(onTopicClusteringWake);
