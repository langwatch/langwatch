import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { SimulationProcessingEvent } from "../schemas/events";
import {
  INITIAL_SCENARIO_EXECUTION_STATE,
  SCENARIO_CANCEL_DEADLINE_MS,
  SCENARIO_DISPATCH_DEADLINE_MS,
  SCENARIO_PROGRESS_DEADLINE_MS,
  scenarioExecutionEventViewSchema,
  type ScenarioExecutionState,
  type scenarioExecutionFailRunIntentSchema,
} from "./scenarioExecutionProcess.types";

/**
 * The `scenarioExecution` process (ADR-062): pure state logic only. The
 * pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
 *
 * Its single job is liveness. A simulation run that stops producing events —
 * because the worker holding its child process was killed, OOMed, or
 * redeployed — must still reach a terminal state. Before this, that was
 * reconstructed by two cross-tenant ClickHouse sweeps that ran **only at
 * worker boot**, so the recovery bound was the deploy cadence rather than
 * anything a user could rely on.
 *
 * **The run's own progress events are the heartbeat.** Every one of them
 * re-arms `nextWakeAt`, so a run that keeps talking keeps pushing its own
 * deadline out, and a run that goes quiet has a wake fire against it. There is
 * no separate keep-alive to maintain, and no polling: the durable wake is the
 * whole mechanism.
 *
 * It does NOT dispatch execution — that still runs through
 * `scenarioExecution.reactor.ts` and the in-process pool. Moving dispatch onto
 * the leased outbox is the second half of ADR-062 and is deliberately separate:
 * this half only adds a safety net and removes the weaker ones it replaces.
 */

export type ScenarioExecutionIntents = {
  failRun: IntentSpec<typeof scenarioExecutionFailRunIntentSchema>;
};

type Ctx = ProcessHandlerContext<ScenarioExecutionIntents>;

/**
 * Narrows a committed simulation event to identities. Mandatory here:
 * message-bearing events would otherwise persist conversation content into
 * process state and outbox rows.
 */
export function buildProcessEventView(event: SimulationProcessingEvent) {
  const data = event.data as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof data[key] === "string" ? (data[key] as string) : null;

  return {
    scenarioRunId: read("scenarioRunId"),
    scenarioId: read("scenarioId"),
    batchRunId: read("batchRunId"),
    scenarioSetId: read("scenarioSetId"),
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
 * already known. Events are delivered at least once and out of order, so a
 * later event missing a field must never blank one an earlier event
 * established.
 */
function withIdentities(
  state: ScenarioExecutionState,
  payload: unknown,
  ctx: Ctx,
): ScenarioExecutionState {
  const view = scenarioExecutionEventViewSchema.parse(payload);
  return {
    ...state,
    // The process key IS the scenarioRunId — it is the pipeline's aggregate id.
    scenarioRunId: state.scenarioRunId || view.scenarioRunId || ctx.key,
    scenarioId: state.scenarioId || view.scenarioId || "",
    batchRunId: state.batchRunId || view.batchRunId || "",
    setId: state.setId || view.scenarioSetId || "",
  };
}

/**
 * Arm the deadline, unless the run has already settled.
 *
 * Once terminal, a run stays terminal: a late `message_snapshot` from a child
 * that outlived its own `finished` event must not re-arm a deadline and
 * resurrect a finished run as failed.
 */
function armed(
  state: ScenarioExecutionState,
  ctx: Ctx,
  windowMs: number,
): ProcessEvolution<ScenarioExecutionState> {
  if (state.settled) return { state, nextWakeAt: null };
  return { state, nextWakeAt: schedulingRef(ctx) + windowMs };
}

const refreshDeadline: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) =>
  armed(withIdentities(state, payload, ctx), ctx, SCENARIO_PROGRESS_DEADLINE_MS);

export const handleQueued: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) =>
  armed(withIdentities(state, payload, ctx), ctx, SCENARIO_DISPATCH_DEADLINE_MS);

export const handleStarted = refreshDeadline;
export const handleMessageSnapshot = refreshDeadline;
export const handleTextMessageStart = refreshDeadline;
export const handleTextMessageEnd = refreshDeadline;

export const handleCancelRequested: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) =>
  armed(
    { ...withIdentities(state, payload, ctx), cancelRequested: true },
    ctx,
    SCENARIO_CANCEL_DEADLINE_MS,
  );

/**
 * A terminal event arrived under its own steam. Clear the deadline and record
 * that the run is done, so no later straggler can re-arm it.
 */
export const handleSettled: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) => ({
  state: { ...withIdentities(state, payload, ctx), settled: true },
  nextWakeAt: null,
});

/**
 * The deadline fired: nothing has reported on this run for a full window, so
 * whatever was executing it is gone. Write the terminal state.
 *
 * `settled` is set here rather than waiting for the resulting `finished` event
 * to fold back, so a wake that fires while the intent is still in the outbox
 * cannot emit a second one.
 */
export const scenarioExecutionWake: WakeHandler<
  ScenarioExecutionState,
  ScenarioExecutionIntents
> = (state, ctx) => {
  const cleared = { state, nextWakeAt: null };

  if (state.settled) return cleared;

  // A process instance that never saw an event carrying identities cannot
  // address a failure at anything. Clearing rather than retrying stops the
  // wake worker re-finding it forever.
  if (!state.scenarioId || !state.batchRunId || !state.setId) return cleared;

  const scenarioRunId = state.scenarioRunId || ctx.key;

  return {
    state: { ...state, settled: true },
    nextWakeAt: null,
    intents: [
      ctx.intents.failRun(`fail:${scenarioRunId}`, {
        projectId: ctx.projectId,
        scenarioRunId,
        scenarioId: state.scenarioId,
        batchRunId: state.batchRunId,
        setId: state.setId,
        cancelled: state.cancelRequested,
        reason: state.cancelRequested
          ? "Cancelled — no worker reported the run finished within the cancellation window"
          : "Scenario run stopped reporting progress — the worker executing it is no longer alive",
      }),
    ],
  };
};

export { INITIAL_SCENARIO_EXECUTION_STATE };
