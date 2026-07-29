import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { ExperimentRunProcessingEvent } from "../schemas/events";
import { parseExperimentRunKey } from "../utils/compositeKey";
import {
  EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
  EXPERIMENT_RUN_STALLED_CODE,
  type ExperimentRunExecutionState,
  experimentRunExecutionEventViewSchema,
  type experimentRunExecutionFailRunIntentSchema,
} from "./experimentRunExecutionProcess.types";

/**
 * The `experimentRunExecution` process (ADR-073): pure state logic only. The
 * pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
 *
 * Its single job is liveness. An experiment run executes inside an async
 * generator in the web request's own process, started with a fire-and-forget
 * `void runExecution()`. Its progress lives in a Redis key on a 24-hour TTL.
 * Nothing reaps it — not even at boot, which is at least what simulations had.
 * A pod restart mid-run leaves the `experiment_runs` row started-with-no-
 * completion permanently, and `isRunFinished` reads that as still running for
 * as long as the row exists.
 *
 * **The run's own result events are the heartbeat.** `target_result` fires per
 * (row, target) and `evaluator_result` per (row, target, evaluator), so a run
 * that is doing work is a run that is talking. Every one of those re-arms
 * `nextWakeAt`; a run that goes quiet has a wake fire against it. There is no
 * separate keep-alive and no polling.
 *
 * It does NOT dispatch execution. ADR-081 establishes that the leasable unit
 * is a slice of cells and that a per-cell time bound is its precondition —
 * `OutboxDispatcherService` leases once and never renews, so a whole-run lease
 * has no correct value. Liveness does not need that work and does not wait for
 * it.
 */

type ExperimentRunExecutionIntents = {
  failRun: IntentSpec<typeof experimentRunExecutionFailRunIntentSchema>;
};

type Ctx = ProcessHandlerContext<ExperimentRunExecutionIntents>;

/**
 * Narrows a committed experiment-run event to identities. Mandatory here:
 * these events carry the customer's dataset rows, the model's outputs,
 * evaluator inputs, scores and free-text failure details, and the default
 * payload would persist every one of them into process state and outbox rows.
 */
export function buildProcessEventView(event: ExperimentRunProcessingEvent) {
  const data = event.data as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof data[key] === "string" ? (data[key] as string) : null;

  return {
    runId: read("runId"),
    experimentId: read("experimentId"),
  };
}

/**
 * Schedule from the present, never from business time alone. A backed-up
 * subscriber can deliver an event whose deadline has already passed;
 * scheduling from it would write a `nextWakeAt` in the past, firing a wake
 * against a run that is in fact still healthy.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * Merge whatever identities this event carried into state, preferring what is
 * already known, and falling back to the process key — which IS the aggregate
 * id, `experimentId:runId`. Events are delivered at least once and out of
 * order, so a later event missing a field must never blank one an earlier
 * event established.
 */
function withIdentities(
  state: ExperimentRunExecutionState,
  payload: unknown,
  ctx: Ctx,
): ExperimentRunExecutionState {
  const view = experimentRunExecutionEventViewSchema.parse(payload);
  const fromKey = parseExperimentRunKey(ctx.key);

  return {
    ...state,
    runId: state.runId || view.runId || fromKey.runId,
    experimentId:
      state.experimentId || view.experimentId || fromKey.experimentId,
  };
}

/**
 * Arm the deadline, unless the run has already settled.
 *
 * Once terminal, a run stays terminal: a straggling `evaluator_result` from a
 * cell that outlived the run's own `completed` event must not re-arm a
 * deadline and resurrect a finished run as failed.
 */
function armed(
  state: ExperimentRunExecutionState,
  ctx: Ctx,
): ProcessEvolution<ExperimentRunExecutionState> {
  if (state.settled) return { state, nextWakeAt: null };
  return {
    state,
    nextWakeAt: schedulingRef(ctx) + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
  };
}

const refreshDeadline: EventHandler<
  ExperimentRunExecutionState,
  unknown,
  ExperimentRunExecutionIntents
> = (state, payload, ctx) => armed(withIdentities(state, payload, ctx), ctx);

/**
 * The run has begun. The gap between this and the first result is one cell's
 * execution, which is the same bound every later gap has, so `started` arms
 * the same window rather than a separate dispatch grace: unlike a queued
 * scenario, an experiment run is already executing by the time this event
 * exists.
 */
export const handleStarted = refreshDeadline;
export const handleTargetResult = refreshDeadline;
export const handleEvaluatorResult = refreshDeadline;

/**
 * The run reached a terminal state under its own steam — completed, or stopped
 * by a user and honoured by a live generator. Clear the deadline and record
 * that the run is done, so no later straggler can re-arm it.
 */
export const handleCompleted: EventHandler<
  ExperimentRunExecutionState,
  unknown,
  ExperimentRunExecutionIntents
> = (state, payload, ctx) => ({
  state: { ...withIdentities(state, payload, ctx), settled: true },
  nextWakeAt: null,
});

/**
 * The deadline fired: nothing has been recorded against this run for a full
 * window, so whatever was executing it is gone. Write the terminal state.
 *
 * `settled` is set here rather than waiting for the resulting `completed`
 * event to fold back, so a wake that fires while the intent is still in the
 * outbox cannot emit a second one.
 */
export const experimentRunExecutionWake: WakeHandler<
  ExperimentRunExecutionState,
  ExperimentRunExecutionIntents
> = (state, ctx) => {
  const cleared = { state, nextWakeAt: null };

  if (state.settled) return cleared;

  const fromKey = parseExperimentRunKey(ctx.key);
  const runId = state.runId || fromKey.runId;
  const experimentId = state.experimentId || fromKey.experimentId;

  // A process instance that never learned which run it is watching cannot
  // address a terminal write at anything. Clearing rather than re-arming stops
  // the wake worker re-finding it forever.
  if (!runId || !experimentId) return cleared;

  return {
    state: { ...state, settled: true },
    nextWakeAt: null,
    intents: [
      // A stable key per run is what lets the outbox collapse a duplicate
      // terminal write into one.
      ctx.intents.failRun(`fail:${runId}`, {
        projectId: ctx.projectId,
        runId,
        experimentId,
        stalledAt: ctx.now,
        code: EXPERIMENT_RUN_STALLED_CODE,
      }),
    ],
  };
};
