import type {
  EventHandler,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessManagerApplier,
  WakeHandler,
} from "@langwatch/eventing";
import {
  TOPIC_CLUSTERING_STALE_RUN_MS,
  topicClusteringSearchAfterSchema,
} from "@langwatch/topic-contract";
import { z } from "zod";

import { nextDailySlot, runIdForSlot } from "../rules/topic-clustering-process.rules.ts";
import type { TopicClusteringProcessingEvent } from "../services/topic-events.service.ts";
import {
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
} from "../services/topic-events.service.ts";
import {
  createTopicClusteringRunHandler,
  TOPIC_CLUSTERING_MAX_ATTEMPTS,
  TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
  TOPIC_CLUSTERING_PROCESS_INTENT_TYPES,
  topicClusteringRunIntentSchema,
  type TopicClusteringDispatchDeps,
  type TopicClusteringIntents,
} from "./topic-clustering.intent.ts";

/**
 * The topic clustering process (ADR-051), authored for the ADR-052
 */

/**
 * Compact private process state (ADR-051 §2): only what evolve() decisions
 * need. Run facts for the UI live in the run-status projection, not here.
 */
export const topicClusteringProcessStateSchema = z.object({
  /** The aggregate identity; needed to compute the daily hash slot on wakes. */
  projectId: z.string(),
  enabled: z.boolean(),
  /**
   * The run in flight, or null when idle; guards a wake or manual request from piling a second
   * run onto an active backlog walk. Abandoned once `startedAtMs` passes the stale-run window.
   */
  currentRun: z
    .object({
      runId: z.string(),
      page: z.number(),
      updatedAtMs: z.number(),
      startedAtMs: z.number().optional(),
    })
    .nullable(),
});
export type TopicClusteringProcessState = z.infer<typeof topicClusteringProcessStateSchema>;

/**
 * The content-stripped view of a pipeline event the process consumes.
 * Clustering events carry no customer content, but the boundary keeps the
 * same shape discipline as other process managers.
 */
const topicClusteringProcessEventViewSchema = z.object({
  trigger: z.string().nullable(),
  runId: z.string().nullable(),
  page: z.number().nullable(),
  hasNextPage: z.boolean(),
  nextSearchAfter: topicClusteringSearchAfterSchema.nullable(),
});
type TopicClusteringProcessEventView = z.infer<typeof topicClusteringProcessEventViewSchema>;

type Ctx = ProcessHandlerContext<TopicClusteringIntents>;

const INITIAL_TOPIC_CLUSTERING_STATE: TopicClusteringProcessState = {
  projectId: "",
  enabled: false,
  currentRun: null,
};

/**
 * Whether a run should still be treated as owning the project at `refMs`. Rows written before
 * `startedAtMs` existed fall back to `updatedAtMs`.
 */
function isRunInFlight(state: TopicClusteringProcessState, refMs: number): boolean {
  const run = state.currentRun;
  if (run === null) return false;
  const startedAtMs = run.startedAtMs ?? run.updatedAtMs;
  return refMs - startedAtMs < TOPIC_CLUSTERING_STALE_RUN_MS;
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
        ? nextDailySlot({ projectId: state.projectId, afterMs: refMs })
        : null,
    intents,
  };
}

/**
 * Whether an outcome event belongs to the run the process currently believes is in flight.
 */
function isCurrentRun(state: TopicClusteringProcessState, runId: string): boolean {
  return state.currentRun?.runId === runId;
}

/**
 * Clamp the scheduling reference to the present. `ctx.at` is business time, so a backed-up
 * subscriber can deliver an event whose next daily slot has ALREADY passed.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

function enabledBase(state: TopicClusteringProcessState, ctx: Ctx): TopicClusteringProcessState {
  return { ...state, projectId: ctx.key, enabled: true };
}

/**
 * The content boundary (`toPayload`): narrows a committed pipeline event to the
 * identities-and-flags view the process is allowed to persist.
 */
export function buildTopicClusteringProcessEventView(
  event: TopicClusteringProcessingEvent,
): TopicClusteringProcessEventView {
  return {
    trigger: "trigger" in event.data ? event.data.trigger : null,
    runId: "runId" in event.data ? event.data.runId : null,
    page: "page" in event.data ? event.data.page : null,
    hasNextPage: "nextSearchAfter" in event.data && event.data.nextSearchAfter != null,
    nextSearchAfter: "nextSearchAfter" in event.data ? (event.data.nextSearchAfter ?? null) : null,
  };
}

const handleClusteringRequested: EventHandler<
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
  // A run that is merely RECORDED — stale, its effect long dead — must not swallow the
  // request. Deferring to it made "Run now" a silent no-op for as long as the wedge lasted
  // while the UI reported success, which is exactly the state a user presses the button in.
  // Identity comes from business time (`ctx.at`), never the clamped ref: a redelivered
  // request must mint the same runId, or it would start a second run.
  const runId = `manual-${ctx.at}`;
  return settle(
    {
      ...base,
      currentRun: { runId, page: 1, updatedAtMs: refMs, startedAtMs: refMs },
    },
    refMs,
    [
      ctx.intent("run", `run:${runId}:page-1`, {
        runId,
        page: 1,
        searchAfter: null,
      }),
    ],
  );
};

const handleClusteringRunCompleted: EventHandler<
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
        startedAtMs: state.currentRun?.startedAtMs ?? state.currentRun?.updatedAtMs ?? refMs,
      },
    },
    refMs,
    [
      ctx.intent("run", `run:${view.runId}:page-${nextPage}`, {
        runId: view.runId,
        page: nextPage,
        searchAfter: view.nextSearchAfter,
      }),
    ],
  );
};

const handleClusteringRunFailed: EventHandler<
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

const topicClusteringWake: WakeHandler<TopicClusteringProcessState, TopicClusteringIntents> = (
  state,
  ctx,
) => {
  if (!state.enabled || !state.projectId) {
    // A wake for a process that was never bootstrapped decides nothing and
    // must clear itself, or the wake worker would re-find it forever.
    return { state, nextWakeAt: null, intents: [] };
  }

  // Clamp the reference instant to the present. A wake that fires late (the fleet was down
  // for days) must schedule the NEXT slot from now, not from the slot it missed — otherwise
  // every skipped day is replayed as its own run within seconds of recovery. Clustering
  // re-derives its work from live
  // unassigned traces, so one catch-up run covers the whole gap (ADR-051:
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
      ctx.intent("run", `run:${runId}:page-1`, {
        runId,
        page: 1,
        searchAfter: null,
      }),
    ],
  );
};

/**
 * The `topicClustering` process-manager topology, exported standalone so tests can build the
 * exact definition the runtime mounts (clamping, key prefixing, undeclared-event guard
 * included) via `buildProcessManager` + `buildProcessDefinition`.
 */
export function topicClusteringProcessManager(
  dispatch: TopicClusteringDispatchDeps,
): ProcessManagerApplier<TopicClusteringProcessingEvent> {
  return (pm) =>
    pm
      .state(topicClusteringProcessStateSchema, INITIAL_TOPIC_CLUSTERING_STATE)
      .intent(
        TOPIC_CLUSTERING_PROCESS_INTENT_TYPES.RUN,
        topicClusteringRunIntentSchema,
        createTopicClusteringRunHandler(dispatch),
      )
      .toPayload(topicClusteringProcessEventViewSchema, (...args) =>
        buildTopicClusteringProcessEventView(...args),
      )
      .on(TopicClusteringRequestedEventSchema, handleClusteringRequested)
      .on(TopicClusteringRunCompletedEventSchema, handleClusteringRunCompleted)
      .on(TopicClusteringRunFailedEventSchema, handleClusteringRunFailed)
      .onWake(topicClusteringWake)
      .outbox({
        // 3 attempts, then the failure is recorded durably (the executor
        // owns the final-attempt record; the cap here is the backstop for
        // executor-crash paths).
        maxAttempts: TOPIC_CLUSTERING_MAX_ATTEMPTS,
        leaseDurationMs: TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
        // ADR-051 §4 promises langevals sees the same load profile as the
        // old worker's `concurrency: 3`; the batch bound keeps leased
        // messages from waiting invisibly behind a slow page.
        concurrency: TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
        batchSize: TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
      });
}
