import type {
  EvolveStep,
  HandlerContext,
  IntentDef,
  ProcessContext,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type {
  EvaluatorResultData,
  RunCompletedData,
  RunStartedData,
  TargetResultData,
} from "./schema";
import { parseExperimentRunAggregateId } from "./schema";

const logger = createLogger(
  "langwatch:experiment-run-processing:experiment-run-execution-process",
);

/**
 * The `experimentRunExecution` process (ADR-073, ADR-103, restored from
 * `event-sourcing.old/pipelines/experiment-run-processing/process-manager/`
 * — the current draft mounted no process manager at all, so a stuck run never
 * reached a terminal state).
 *
 * Its single job is liveness. An experiment run executes inside an async
 * generator in the web request's own process, started fire-and-forget. A pod
 * restart mid-run leaves the `experiment_runs` row started-with-no-completion
 * permanently, and nothing else notices.
 *
 * **The run's own result events are the heartbeat.** `targetResult` fires per
 * (row, target) and `evaluatorResult` per (row, target, evaluator), so a run
 * that is doing work is a run that is talking. Every one of those re-arms
 * `nextWakeAt`; a run that goes quiet has a wake fire against it.
 */

/** How long an experiment run may produce nothing before it is declared dead
 * (see the deployed constant's own rationale — a heuristic, not a derivation,
 * pending a per-cell execution cap). */
export const EXPERIMENT_RUN_PROGRESS_DEADLINE_MS = 30 * 60 * 1000;

/** What a fired deadline records as the cause — a stable code, never prose
 * (ADR-045). */
export const EXPERIMENT_RUN_STALLED_CODE = "lw.experiment_run_stalled";

/**
 * `definePipeline` has no field for outbox tuning, so these travel as
 * exported constants for whichever runtime configures this process manager's
 * outbox rather than being silently dropped.
 */
export const EXPERIMENT_RUN_EXECUTION_MAX_ATTEMPTS = 3;
export const EXPERIMENT_RUN_EXECUTION_LEASE_DURATION_MS = 60_000;

export const experimentRunExecutionStateSchema = z.object({
  /** Empty until the first event carrying identities is folded. */
  runId: z.string(),
  experimentId: z.string(),
  /** A terminal event arrived, or a wake wrote one. The deadline stays off. */
  settled: z.boolean(),
});
export type ExperimentRunExecutionState = z.infer<
  typeof experimentRunExecutionStateSchema
>;

export function initExperimentRunExecutionState(): ExperimentRunExecutionState {
  return { runId: "", experimentId: "", settled: false };
}

export const experimentRunExecutionFailRunIntentSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  /** The instant the deadline fired; recorded as the run's terminal time. */
  stalledAt: z.number(),
  code: z.string(),
});
export type ExperimentRunExecutionFailRunIntent = z.infer<
  typeof experimentRunExecutionFailRunIntentSchema
>;

export interface ExperimentRunExecutionIntents {
  readonly failRun: IntentDef<typeof experimentRunExecutionFailRunIntentSchema>;
}

type Step = EvolveStep<
  ExperimentRunExecutionState,
  ExperimentRunExecutionIntents
>;

/**
 * Schedule from the present, never from business time alone. A backed-up
 * subscriber can deliver an event whose deadline has already passed;
 * scheduling from it would write a `nextWakeAt` in the past, firing a wake
 * against a run that is in fact still healthy.
 */
function schedulingRef(occurredAt: number, ctx: ProcessContext): number {
  return Math.max(occurredAt, ctx.now);
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
  runId: string,
  experimentId: string,
  ctx: ProcessContext,
): ExperimentRunExecutionState {
  const fromKey = parseExperimentRunAggregateId(ctx.processKey);
  return {
    ...state,
    runId: state.runId || runId || fromKey.runId,
    experimentId: state.experimentId || experimentId || fromKey.experimentId,
  };
}

/**
 * Arm the deadline, unless the run has already settled.
 *
 * Once terminal, a run stays terminal: a straggling `evaluatorResult` from a
 * cell that outlived the run's own `completed` event must not re-arm a
 * deadline and resurrect a finished run as failed.
 */
function armed(state: ExperimentRunExecutionState, refMs: number): Step {
  if (state.settled) return { state, intents: [], nextWakeAt: null };
  return {
    state,
    intents: [],
    nextWakeAt: refMs + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
  };
}

/**
 * The run has begun. The gap between this and the first result is one cell's
 * execution, which is the same bound every later gap has, so `started` arms
 * the same window rather than a separate dispatch grace.
 */
export function handleExperimentRunStarted(
  state: ExperimentRunExecutionState,
  data: RunStartedData,
  ctx: ProcessContext,
): Step {
  const next = withIdentities(state, data.runId, data.experimentId, ctx);
  return armed(next, schedulingRef(data.occurredAt, ctx));
}

export function handleExperimentRunTargetResult(
  state: ExperimentRunExecutionState,
  data: TargetResultData,
  ctx: ProcessContext,
): Step {
  const next = withIdentities(state, data.runId, data.experimentId, ctx);
  return armed(next, schedulingRef(data.occurredAt, ctx));
}

export function handleExperimentRunEvaluatorResult(
  state: ExperimentRunExecutionState,
  data: EvaluatorResultData,
  ctx: ProcessContext,
): Step {
  const next = withIdentities(state, data.runId, data.experimentId, ctx);
  return armed(next, schedulingRef(data.occurredAt, ctx));
}

/**
 * The run reached a terminal state under its own steam — completed, or
 * stopped by a user and honoured by a live generator. Clear the deadline and
 * record that the run is done, so no later straggler can re-arm it.
 */
export function handleExperimentRunCompleted(
  state: ExperimentRunExecutionState,
  data: RunCompletedData,
  ctx: ProcessContext,
): Step {
  const next = withIdentities(state, data.runId, data.experimentId, ctx);
  return { state: { ...next, settled: true }, intents: [], nextWakeAt: null };
}

/**
 * The deadline fired: nothing has been recorded against this run for a full
 * window, so whatever was executing it is gone. Fire the terminal-write
 * intent.
 *
 * `settled` is set here rather than waiting for the resulting `completed`
 * event to fold back, so a wake that fires while the intent is still
 * outstanding cannot emit a second one.
 */
export function onExperimentRunExecutionWake(
  state: ExperimentRunExecutionState,
  ctx: ProcessContext,
): Step {
  if (state.settled) return { state, intents: [], nextWakeAt: null };

  const fromKey = parseExperimentRunAggregateId(ctx.processKey);
  const runId = state.runId || fromKey.runId;
  const experimentId = state.experimentId || fromKey.experimentId;

  // A process instance that never learned which run it is watching cannot
  // address a terminal write at anything. Clearing rather than re-arming stops
  // the wake worker re-finding it forever.
  if (!runId || !experimentId) {
    return { state, intents: [], nextWakeAt: null };
  }

  return {
    state: { ...state, runId, experimentId, settled: true },
    intents: [
      {
        type: "failRun",
        payload: {
          runId,
          experimentId,
          stalledAt: ctx.now,
          code: EXPERIMENT_RUN_STALLED_CODE,
        },
      },
    ],
    nextWakeAt: null,
  };
}

/** What the terminal write needs from the experiment-run domain — supplied by
 * the composition root, the same way a store is (ADR-105 decision 6). */
export interface ExperimentRunExecutionDeps {
  /**
   * Records the run's terminal event. Idempotent — `completeExperimentRun`
   * carries a fixed `${tenantId}:${runId}:complete` idempotency key upstream
   * of this pipeline's dispatcher, so a repeat, or a race with the run's own
   * completion, collapses to one folded event.
   */
  readonly completeRun: (params: {
    tenantId: string;
    runId: string;
    experimentId: string;
    finishedAt: number | null;
    stoppedAt: number | null;
    occurredAt: number;
  }) => Promise<void>;
  /** Raises the run's abort flag, so a run the deadline declared dead stops
   * spending the customer's money if it is in fact still executing. */
  readonly signalStop: (params: { runId: string }) => Promise<void>;
  /** Marks the cached run-state record failed, with the failure code.
   * Best-effort: the record is routinely absent. */
  readonly markRunFailed: (params: {
    runId: string;
    code: string;
  }) => Promise<void>;
}

/**
 * Executes the `failRun` intent: records that a run nobody is executing any
 * more has ended.
 *
 * Ordering is deliberate. The abort flag is raised first, because it is the
 * one step that changes what a still-live generator does; the durable write
 * follows and is the only step allowed to fail the intent; the cached record
 * is updated last and never blocks either.
 */
export async function deliverExperimentRunExecutionFailRun(
  payload: ExperimentRunExecutionFailRunIntent,
  ctx: HandlerContext,
  deps: ExperimentRunExecutionDeps,
): Promise<void> {
  logger.info(
    {
      tenantId: ctx.tenantId,
      runId: payload.runId,
      experimentId: payload.experimentId,
    },
    "Deadline fired for an experiment run with no live process — writing terminal state",
  );

  await deps.signalStop({ runId: payload.runId }).catch((err: unknown) => {
    logger.warn(
      { err, runId: payload.runId },
      "Could not raise the abort flag for a stalled experiment run",
    );
  });

  // `stoppedAt` rather than `finishedAt`: a run the platform ended is not a
  // run that finished, and claiming otherwise would show a partial result set
  // as a complete one.
  await deps.completeRun({
    tenantId: ctx.tenantId,
    runId: payload.runId,
    experimentId: payload.experimentId,
    finishedAt: null,
    stoppedAt: payload.stalledAt,
    occurredAt: payload.stalledAt,
  });

  // Deliberately after the durable write, and deliberately swallowed: the
  // guarantee is the event, not the cache.
  await deps
    .markRunFailed({ runId: payload.runId, code: payload.code })
    .catch((err: unknown) => {
      logger.warn(
        { err, runId: payload.runId },
        "Could not mark the cached run-state record failed for a stalled experiment run",
      );
    });
}
