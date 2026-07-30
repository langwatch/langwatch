import type { ProcessManagerApplier } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  createRunMetricsComputeHandler,
  type RunMetricsDispatchDeps,
} from "./runMetricsIntentHandlers";
import {
  computeRunMetricsMessageKey,
  INITIAL_RUN_METRICS_STATE,
  RUN_METRICS_INTENT_TYPES,
  RUN_METRICS_LEASE_DURATION_MS,
  RUN_METRICS_MAX_ATTEMPTS,
  RUN_METRICS_MAX_MEASUREMENTS,
  RUN_METRICS_REMEASURE_DELAYS_MS,
  RUN_METRICS_SETTLE_PERIOD_MS,
  type RunMetricsState,
  runMetricsComputeIntentSchema,
  runMetricsEventViewSchema,
} from "./runMetricsProcess.types";

/**
 * The `runMetrics` process: pure state logic only. The pipeline mounts these
 * handlers; the runtime owns the manager, its outbox and its wake worker.
 *
 * **What it is for.** A simulation run's cost and latency live in its traces,
 * which are ingested on their own path. Something has to decide when the run is
 * worth measuring, ask for it, and — while the answer keeps coming back empty —
 * ask again a bounded number of times. That is this.
 *
 * **Why one measurement per ask, over the whole run.** Its two predecessors
 * dispatched per TRACE — one from the trace pipeline when a scenario trace went
 * quiet, one from the simulation pipeline for every trace the run still lacked
 * metrics for — and each dispatch emitted a per-trace event. The run's fold then
 * had to keep an unbounded `traceId -> metrics` map to re-aggregate from, and
 * because the per-trace event's idempotency key never varied, the event store's
 * keep-the-first rule froze whatever the earliest attempt saw. A run measured
 * while cost enrichment was still in flight showed zero forever. Measuring the
 * whole run at once removes the accumulator, and fingerprinting the event on the
 * values removes the freeze: a better answer is a different event and lands.
 *
 * **Why it may ask more than once.** Measuring is a bet that the run's cost is
 * knowable by the time the settle period elapses, and the two are not on the
 * same clock: spans are exported on the agent SDK's schedule and priced when
 * they fold, so a run can report its result before its traces exist. When the
 * bet loses, every trace reads back unpriced and the command records nothing —
 * which is precisely the signal to ask again. It re-arms on that empty answer,
 * along a short finite ladder ({@link RUN_METRICS_REMEASURE_DELAYS_MS}), and a
 * recorded measurement ends the ladder early. So the runs that pay for the
 * re-measures are the ones that need them; a run measured successfully is asked
 * for exactly once, as before.
 *
 * **Why a deadline rather than a queue delay.** The settle period has to survive
 * the worker that armed it. A job delay lives only inside that job, so a worker
 * lost while holding it took the run's only measurement with it; `nextWakeAt` is
 * a column on the process instance, and the wake worker finds it after a
 * restart.
 *
 * **What it deliberately does NOT do** is watch the run's messages. The traces
 * to aggregate over are read from the run's own stored state when the command
 * runs, so this process is on the inbox for the two terminal events and the
 * run's own metrics event — a handful of rows per run, not one per message —
 * and a trace that arrived after the run finished is still measured.
 */

type RunMetricsIntents = {
  computeRunMetrics: IntentSpec<typeof runMetricsComputeIntentSchema>;
};

type Ctx = ProcessHandlerContext<RunMetricsIntents>;

type RunMetricsEventHandler = EventHandler<
  RunMetricsState,
  unknown,
  RunMetricsIntents
>;

/**
 * Narrows a committed simulation event to the one identity this process reasons
 * about.
 *
 * Mandatory, and mandatory to keep TOTAL. Mandatory because `finished` carries
 * the judge's reasoning and the run's error text, which would otherwise be
 * persisted into process state and outbox rows verbatim; total because a throw
 * fails the inbox write and every retry repeats it against the same stored
 * event, so the instance would never advance past the event that broke it. Hence
 * a field pick with a type test rather than a parse: an unreadable field yields
 * no id, and the process key supplies it instead.
 */
export function buildRunMetricsEventView(event: SimulationProcessingEvent) {
  const data = (event.data ?? {}) as Record<string, unknown>;
  return {
    scenarioRunId:
      typeof data.scenarioRunId === "string" ? data.scenarioRunId : null,
  };
}

/**
 * Schedule from the present, never from business time alone. A backed-up
 * subscriber can deliver a terminal event whose settle period has already
 * elapsed; scheduling from `ctx.at` would write a deadline in the past and
 * measure a run whose spans are still arriving.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

function withRunId(
  state: RunMetricsState,
  payload: unknown,
  ctx: Ctx,
): RunMetricsState {
  const view = runMetricsEventViewSchema.parse(payload);
  return {
    ...state,
    // The process key IS the scenarioRunId — it is the pipeline's aggregate id.
    scenarioRunId: state.scenarioRunId || view.scenarioRunId || ctx.key,
  };
}

/**
 * The run reported a result. Arm the settle period.
 *
 * A repeat `finished` — a child that outlived the worker whose orphan
 * reconciliation already wrote one — does not re-arm: the measurement has
 * either been asked for already, in which case the re-measure ladder owns the
 * timing from here, or the deadline is still standing.
 */
export const handleFinished: RunMetricsEventHandler = (state, payload, ctx) => {
  const seen = withRunId(state, payload, ctx);

  if (
    seen.deleted ||
    seen.measured ||
    seen.attempts > 0 ||
    seen.deadlineAt !== null
  ) {
    return { state: seen, nextWakeAt: seen.deadlineAt };
  }

  // A run with no addressable key cannot be measured: the command reads the
  // run's stored state back by id. Never arm one.
  if (!seen.scenarioRunId) {
    return { state: { ...seen, deadlineAt: null }, nextWakeAt: null };
  }

  const deadlineAt = schedulingRef(ctx) + RUN_METRICS_SETTLE_PERIOD_MS;
  return { state: { ...seen, deadlineAt }, nextWakeAt: deadlineAt };
};

/**
 * The run was soft-deleted. Drop any pending measurement — computing cost for a
 * run nobody can open spends reads and writes a metric onto a hidden row.
 */
export const handleDeleted: RunMetricsEventHandler = (state, payload, ctx) => ({
  state: { ...withRunId(state, payload, ctx), deleted: true, deadlineAt: null },
  nextWakeAt: null,
});

/**
 * The run's metrics were recorded. There is nothing left to ask for.
 *
 * This is the only thing that ends the re-measure ladder early, and it is what
 * keeps the ladder off every run that was measured successfully: the command
 * emits this event, the process reads it back on its own inbox, and the wake it
 * had standing for a re-measure is dropped. A stale wake would also stand down
 * on its own — the revision it was scheduled at is superseded by this commit —
 * so the ladder ends whether or not the disarm wins the race.
 */
export const handleMeasured: RunMetricsEventHandler = (
  state,
  payload,
  ctx,
) => ({
  state: {
    ...withRunId(state, payload, ctx),
    measured: true,
    deadlineAt: null,
  },
  nextWakeAt: null,
});

/**
 * A measurement is due. Ask for it, and arm the next rung of the ladder.
 *
 * `attempts` is advanced here rather than when the measurement lands, so a
 * second wake racing the first sees the same stored state, computes the same
 * attempt, and collapses onto the same message key instead of asking twice.
 *
 * The wake that is armed alongside the request is the re-measure: nothing tells
 * this process that a measurement came back empty, because an empty answer is
 * not an event. So the next rung is armed unconditionally and taken back by
 * {@link handleMeasured} when the measurement does record something. The ladder
 * is finite — once {@link RUN_METRICS_REMEASURE_DELAYS_MS} runs out there is no
 * rung left to arm, and a run whose traces never report a cost stops asking.
 */
export const runMetricsWake: WakeHandler<RunMetricsState, RunMetricsIntents> = (
  state,
  ctx,
) => {
  const cleared: ProcessEvolution<RunMetricsState> = {
    state: { ...state, deadlineAt: null },
    nextWakeAt: null,
  };

  const scenarioRunId = state.scenarioRunId || ctx.key;

  // A wake on a deleted or already-measured run, or one that cannot be
  // addressed at all, has nothing to ask for. Clearing rather than retrying
  // stops the wake worker re-finding this instance forever.
  if (state.deleted || state.measured || !scenarioRunId || !ctx.projectId) {
    return cleared;
  }

  const attempt = state.attempts + 1;
  // The cap, stated rather than left to fall out of the ladder's length: a wake
  // that outlived its rung must not be able to buy another measurement.
  if (attempt > RUN_METRICS_MAX_MEASUREMENTS) return cleared;

  const remeasureDelayMs = RUN_METRICS_REMEASURE_DELAYS_MS[state.attempts];
  const deadlineAt =
    remeasureDelayMs === undefined
      ? null
      : schedulingRef(ctx) + remeasureDelayMs;

  return {
    state: { ...state, scenarioRunId, attempts: attempt, deadlineAt },
    nextWakeAt: deadlineAt,
    intents: [
      ctx.intents.computeRunMetrics(
        computeRunMetricsMessageKey(scenarioRunId, attempt),
        { tenantId: ctx.projectId, scenarioRunId },
      ),
    ],
  };
};

/**
 * The `runMetrics` topology, exported standalone so the pipeline mounts it in
 * one line and tests can build the exact definition the runtime does.
 *
 * The outbox is sized by what the intent does — one queue send — rather than by
 * what it triggers: a short lease, and attempts generous enough to ride out a
 * restart, because a repeat collapses on the message key and a loss costs a run
 * a rung of its ladder.
 */
export function runMetricsPM(
  dispatch: RunMetricsDispatchDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_RUN_METRICS_STATE)
      .intent(
        RUN_METRICS_INTENT_TYPES.COMPUTE_RUN_METRICS,
        runMetricsComputeIntentSchema,
        createRunMetricsComputeHandler(dispatch),
      )
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleFinished)
      .on(SIMULATION_RUN_EVENT_TYPES.DELETED, handleDeleted)
      // The run's own measurement, read back. This is how the process learns
      // that it has an answer — without it, "measured" and "measured too early"
      // are indistinguishable and the re-measure ladder would run to its cap on
      // every run.
      .on(SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED, handleMeasured)
      .onWake(runMetricsWake)
      .toPayload(buildRunMetricsEventView)
      .outbox({
        maxAttempts: RUN_METRICS_MAX_ATTEMPTS,
        leaseDurationMs: RUN_METRICS_LEASE_DURATION_MS,
      });
}
