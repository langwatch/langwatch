/**
 * The run's execution manager (ARCHITECTURE §9): the concurrency window over a run's cells, phase 2
 * opened once phase 1 drains, abort, completion and the stall backstop. Pure over counts; the plan
 * stays in `started` and the run's fold. Design: specs/experiment-run-execution.md sections 4 to 6.
 */
import type {
  EventHandler,
  IntentExecutor,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessIntent,
  ProcessManagerApplier,
  WakeHandler,
} from "@langwatch/eventing";

import { EXPERIMENT_RUN_EVENT_TYPES } from "../rules/experiment-run-event-types.rules.ts";
import { countFinished, hasFinished, markFinished } from "../rules/experiment-run-window.rules.ts";
import {
  abortRequestedEventSchema,
  cellFinishedEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  type ExperimentRunProcessingEvent,
} from "./experiment-run-events.process.ts";
import {
  type CompleteRunIntent,
  completeRunIntentSchema,
  EXPERIMENT_RUN_STALL_MS,
  type ExecuteCellIntent,
  executeCellIntentSchema,
  type ExperimentRunExecutionIntents,
  type ExperimentRunExecutionState,
  experimentRunExecutionStateSchema,
  type ExperimentRunExecutionView,
  experimentRunExecutionViewSchema,
  type FailCellIntent,
  failCellIntentSchema,
  INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
} from "./experiment-run-execution.schemas.ts";

type State = ExperimentRunExecutionState;
type Context = ProcessHandlerContext<ExperimentRunExecutionIntents>;
type Handler = EventHandler<State, ExperimentRunExecutionView, ExperimentRunExecutionIntents>;

const totalCells = (state: State): number => state.phaseOneCells + state.phaseTwoCells;

const phaseOf = (state: State, ordinal: number): 1 | 2 => (ordinal < state.phaseOneCells ? 1 : 2);

const stallDeadline = (state: State): number => state.lastActivityAt + EXPERIMENT_RUN_STALL_MS;

/** Cells sent and not yet finished. */
function inFlight(state: State): number {
  return (
    state.nextOrdinal - countFinished({ bitmap: state.finished, from: 0, to: state.nextOrdinal })
  );
}

/** Phase 2 opens only once every phase-1 cell has finished (D5). */
function sendLimit(state: State): number {
  const phaseOneDone =
    countFinished({ bitmap: state.finished, from: 0, to: state.phaseOneCells }) ===
    state.phaseOneCells;
  return phaseOneDone ? totalCells(state) : state.phaseOneCells;
}

/** Sends cells until the window is full or nothing more may go, skipping cells already failed. */
function fillWindow(state: State, ctx: Context): { state: State; intents: ProcessIntent[] } {
  const intents: ProcessIntent[] = [];
  const limit = sendLimit(state);
  let sending = inFlight(state);
  let ordinal = state.nextOrdinal;
  while (!state.aborting && sending < state.concurrency && ordinal < limit) {
    if (!hasFinished({ bitmap: state.finished, ordinal })) {
      const phase = phaseOf(state, ordinal);
      intents.push(
        ctx.intent("executeCell", `cell:${ordinal}:${phase}`, {
          runId: state.runId,
          experimentId: state.experimentId,
          ordinal,
          phase,
        }),
      );
      sending += 1;
    }
    ordinal += 1;
  }
  return { state: { ...state, nextOrdinal: ordinal }, intents };
}

/** The run's end: every cell finished, or a stopping run with nothing left in flight. */
function runOutcome(state: State): CompleteRunIntent["outcome"] | "running" {
  const total = totalCells(state);
  if (countFinished({ bitmap: state.finished, from: 0, to: total }) === total) return "finished";
  if (state.aborting && inFlight(state) === 0) return "stopped";
  return "running";
}

/** Completes the run once it has an outcome; otherwise re-arms the stall wake. */
function settle(state: State, ctx: Context, intents: ProcessIntent[]): ProcessEvolution<State> {
  const outcome = runOutcome(state);
  if (outcome === "running") return { state, nextWakeAt: stallDeadline(state), intents };

  return {
    state: { ...state, status: "terminal" },
    nextWakeAt: null,
    intents: [
      ...intents,
      ctx.intent("complete", "complete", {
        runId: state.runId,
        experimentId: state.experimentId,
        outcome,
      }),
    ],
  };
}

/** A run's start opens the window; a start without a plan is folded, never driven. */
export const handleRunStarted: Handler = (state, view, ctx) => {
  if (view.kind !== "started" || !view.window || state.status !== "idle") {
    return { state, nextWakeAt: state.status === "running" ? stallDeadline(state) : null };
  }

  const opened: State = {
    ...state,
    status: "running",
    runId: view.runId,
    experimentId: view.experimentId,
    concurrency: view.window.concurrency,
    phaseOneCells: view.window.phaseOneCells,
    phaseTwoCells: view.window.phaseTwoCells,
    lastActivityAt: Math.max(ctx.at, ctx.now),
  };
  const filled = fillWindow(opened, ctx);
  return settle(filled.state, ctx, filled.intents);
};

/** A finished cell counts once, then frees its place in the window for the next. */
export const handleCellFinished: Handler = (state, view, ctx) => {
  if (view.kind !== "cell_finished" || state.status !== "running") {
    return { state, nextWakeAt: state.status === "running" ? stallDeadline(state) : null };
  }
  if (
    view.ordinal >= totalCells(state) ||
    hasFinished({ bitmap: state.finished, ordinal: view.ordinal })
  ) {
    return { state, nextWakeAt: stallDeadline(state) };
  }

  const counted: State = {
    ...state,
    finished: markFinished({ bitmap: state.finished, ordinal: view.ordinal }),
    lastActivityAt: Math.max(ctx.at, ctx.now),
  };
  const filled = fillWindow(counted, ctx);
  return settle(filled.state, ctx, filled.intents);
};

/** An abort sends nothing more; the run stops once its cells in flight have finished. */
export const handleAbortRequested: Handler = (state, _view, ctx) => {
  if (state.status !== "running") {
    return { state, nextWakeAt: null };
  }
  return settle({ ...state, aborting: true }, ctx, []);
};

/** However the run ended, the manager is done with it. */
export const handleRunCompleted: Handler = (state) => ({
  state: { ...state, status: "terminal" },
  nextWakeAt: null,
});

/** No cell finished for the stall window: every unfinished cell is failed so the run completes. */
export const experimentRunStallWake: WakeHandler<State, ExperimentRunExecutionIntents> = (
  state,
  ctx,
) => {
  if (state.status !== "running") return { state, nextWakeAt: null };
  if (ctx.now < stallDeadline(state)) return { state, nextWakeAt: stallDeadline(state) };

  const total = totalCells(state);
  const intents: ProcessIntent[] = [];
  for (let ordinal = 0; ordinal < total; ordinal += 1) {
    if (hasFinished({ bitmap: state.finished, ordinal })) continue;
    const phase = phaseOf(state, ordinal);
    intents.push(
      ctx.intent("failCell", `fail:${ordinal}:${phase}`, {
        runId: state.runId,
        experimentId: state.experimentId,
        ordinal,
        phase,
      }),
    );
  }
  const given: State = { ...state, nextOrdinal: total, lastActivityAt: ctx.now };
  return { state: given, nextWakeAt: stallDeadline(given), intents };
};

/** The content boundary: each event narrowed to what the manager counts. */
export function experimentRunExecutionView(
  event: ExperimentRunProcessingEvent,
): ExperimentRunExecutionView {
  switch (event.type) {
    case EXPERIMENT_RUN_EVENT_TYPES.STARTED: {
      const plan = event.data.plan;
      const phaseOneCells = plan?.cells.filter((cell) => cell.phase === 1).length ?? 0;
      return {
        kind: "started",
        runId: event.data.runId,
        experimentId: event.data.experimentId,
        window: plan
          ? {
              concurrency: plan.concurrency,
              phaseOneCells,
              phaseTwoCells: plan.cells.length - phaseOneCells,
            }
          : null,
      };
    }
    case EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED:
      return { kind: "cell_finished", ordinal: event.data.ordinal };
    case EXPERIMENT_RUN_EVENT_TYPES.ABORT_REQUESTED:
      return { kind: "abort_requested" };
    case EXPERIMENT_RUN_EVENT_TYPES.COMPLETED:
      return { kind: "completed" };
    default:
      return { kind: "other" };
  }
}

/** What the manager's intents do once the outbox delivers them. */
export interface ExperimentRunExecutionEffects {
  executeCell: IntentExecutor<ExecuteCellIntent>;
  failCell: IntentExecutor<FailCellIntent>;
  complete: IntentExecutor<CompleteRunIntent>;
}

/** The manager's topology, keyed by the run's aggregate (its runId alone without an experiment). */
export function experimentRunExecutionProcess(
  effects: ExperimentRunExecutionEffects,
): ProcessManagerApplier<ExperimentRunProcessingEvent> {
  return (pm) =>
    pm
      .state(experimentRunExecutionStateSchema, INITIAL_EXPERIMENT_RUN_EXECUTION_STATE)
      .intent("executeCell", executeCellIntentSchema, effects.executeCell)
      .intent("failCell", failCellIntentSchema, effects.failCell)
      .intent("complete", completeRunIntentSchema, effects.complete)
      .toPayload(experimentRunExecutionViewSchema, experimentRunExecutionView)
      .on(experimentRunStartedEventSchema, handleRunStarted)
      .on(cellFinishedEventSchema, handleCellFinished)
      .on(abortRequestedEventSchema, handleAbortRequested)
      .on(experimentRunCompletedEventSchema, handleRunCompleted)
      .onWake(experimentRunStallWake)
      .outbox({ maxAttempts: 5, concurrency: 5, batchSize: 5 });
}
