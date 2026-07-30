import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import type { SimulationProcessingEvent } from "../schemas/events";
import {
  dispatchDeadlineMsFor,
  executeRunMessageKey,
  failRunMessageKey,
  SCENARIO_CANCEL_DEADLINE_MS,
  SCENARIO_PROGRESS_DEADLINE_MS,
  type ScenarioExecutionState,
  scenarioExecutionEventViewSchema,
  type scenarioExecutionExecuteRunIntentSchema,
  type scenarioExecutionFailRunIntentSchema,
  scenarioExecutionTargetSchema,
} from "./scenarioExecutionProcess.types";

/**
 * The `scenarioExecution` process (ADR-103): pure state logic only. The
 * pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
 *
 * It carries the two guarantees the substrate supplies, one each:
 *
 * **Dispatch** is the leased outbox. A `queued` event enqueues an `executeRun`
 * message; whichever worker leases it holds the child process for the whole
 * lease. Pending work is a Postgres row rather than an array field on a pod,
 * so a hard kill no longer loses it, and there is no wiring window in which a
 * dispatch is silently dropped — the predecessor reactor logged
 * "Execution pool not yet wired, skipping" and orphaned the run at QUEUED.
 *
 * **Liveness** is the durable wake. The run's own progress events are the
 * heartbeat: every one of them re-arms `nextWakeAt`, so a run that keeps
 * talking keeps pushing its own deadline out, and a run that goes quiet has a
 * wake fire against it. When one fires the process writes the terminal state
 * itself, as a stored `STALLED` — the read path no longer derives it, so what
 * is stored and what is displayed cannot disagree.
 *
 * The two are deliberately not the same mechanism. Crash recovery comes from
 * the wake, never from redelivering a dispatch, because a scenario costs money
 * per run.
 */

type ScenarioExecutionIntents = {
  executeRun: IntentSpec<typeof scenarioExecutionExecuteRunIntentSchema>;
  failRun: IntentSpec<typeof scenarioExecutionFailRunIntentSchema>;
};

type Ctx = ProcessHandlerContext<ScenarioExecutionIntents>;

/**
 * Narrows a committed simulation event to identities and the dispatch target.
 * Mandatory here: message-bearing events would otherwise persist conversation
 * content into process state and outbox rows.
 *
 * `batchTotal` is the one non-identity field beyond the target that crosses: it
 * is a bounded integer, and {@link handleQueued} cannot size the dispatch
 * deadline without it. Anything wider stays on the far side of this narrowing.
 *
 * The view must be TOTAL — it runs at the enqueue seam, where a throw wedges
 * the run's process instance — so a target that fails its schema degrades to
 * `null`, the same value an event carrying no target at all produces. Both end
 * the same way: nothing is enqueued and the armed deadline finalises the run.
 * A malformed target is a configuration bug rather than a stall, though, and
 * the terminal write cannot currently say so: telling the two apart needs a
 * discriminator on the persisted view schema and on
 * `ScenarioExecutionState` (`scenarioExecutionProcess.types.ts`), which the
 * wake would then report as its own outcome.
 */
export function buildProcessEventView(event: SimulationProcessingEvent) {
  const data = event.data as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof data[key] === "string" ? (data[key] as string) : null;
  const target = scenarioExecutionTargetSchema.safeParse(data.target);

  return {
    scenarioRunId: read("scenarioRunId"),
    scenarioId: read("scenarioId"),
    batchRunId: read("batchRunId"),
    scenarioSetId: read("scenarioSetId"),
    // Guarded rather than passed through: the view schema rejects a negative
    // or fractional total, and a malformed legacy row must degrade to "unknown
    // batch size" rather than throw and wedge the run's process instance.
    batchTotal:
      typeof data.batchTotal === "number" &&
      Number.isInteger(data.batchTotal) &&
      data.batchTotal >= 0
        ? data.batchTotal
        : null,
    target: target.success ? target.data : null,
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
    target: state.target ?? view.target,
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
  // Once a cancel is asked for, the cancel window governs every later arming.
  // A child commonly finishes streaming its current message before it honours
  // SIGTERM, so `cancel_requested` is routinely followed by progress events —
  // and those run through `refreshDeadline`, which asks for the 30-minute
  // progress window. Taking it would push a cancelled run's deadline back out
  // by half an hour, which is the opposite of what cancelling asked for.
  //
  // The window still slides forward from the last sign of life rather than
  // being pinned to the cancel instant: while progress keeps arriving a worker
  // demonstrably still holds the child, and that is the case the short window
  // was never aimed at. It fires 60s after the run actually goes quiet.
  const effectiveMs = state.cancelRequested
    ? Math.min(windowMs, SCENARIO_CANCEL_DEADLINE_MS)
    : windowMs;
  return { state, nextWakeAt: schedulingRef(ctx) + effectiveMs };
}

const refreshDeadline: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) =>
  armed(
    withIdentities(state, payload, ctx),
    ctx,
    SCENARIO_PROGRESS_DEADLINE_MS,
  );

/**
 * The run is queued: enqueue its dispatch and arm the window it has to be
 * picked up in.
 *
 * The dispatch is emitted here rather than by a handler beside the fold, which
 * is what ADR-103 requires: the message is committed in the same
 * transaction as the inbox row, so a worker that dies between "the event was
 * consumed" and "the job was submitted" no longer loses the run.
 *
 * The window it arms is derived from the batch the run queued with rather than
 * fixed: a run waits behind its siblings for as long as the batch takes, so a
 * fixed window would declare the tail of a large healthy batch dead. See
 * {@link dispatchDeadlineMsFor}.
 *
 * A run that has already settled — a `queued` redelivered after the run
 * finished, which the fold guards against for the same reason — enqueues
 * nothing. So does a run whose `queued` event carries no target: there is
 * nothing to execute, and the armed deadline finalises it rather than the
 * outbox retrying a dispatch that can never be built.
 */
export const handleQueued: EventHandler<
  ScenarioExecutionState,
  unknown,
  ScenarioExecutionIntents
> = (state, payload, ctx) => {
  const view = scenarioExecutionEventViewSchema.parse(payload);
  const next = withIdentities(state, payload, ctx);
  const evolution = armed(
    next,
    ctx,
    dispatchDeadlineMsFor(view.batchTotal ?? 0),
  );
  if (next.settled || !next.target) return evolution;

  const scenarioRunId = next.scenarioRunId || ctx.key;
  return {
    ...evolution,
    intents: [
      ctx.intents.executeRun(executeRunMessageKey(scenarioRunId), {
        projectId: ctx.projectId,
        scenarioRunId,
        scenarioId: next.scenarioId,
        batchRunId: next.batchRunId,
        setId: next.setId,
        target: next.target,
      }),
    ],
  };
};

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

  // A process instance that never saw an event carrying the run's placement
  // cannot address a failure at anything. Clearing rather than retrying stops
  // the wake worker re-finding it forever.
  //
  // `scenarioId` is deliberately NOT part of this test, and requiring it was a
  // bug. Only `queued` and `started` carry it — `runPlacementFields` adds the
  // batch and set ids to the progress events and nothing else — so a run whose
  // instance folded snapshots but never a `started` had no scenario id to show
  // and could never be terminalised at all: the wake cleared instead of
  // writing, and with the read-time stall derivation gone the run displayed as
  // IN_PROGRESS for good. The terminal write does not need it. It addresses the
  // run by id, and the scenario id only fetches the display fields a reaped run
  // is decorated with, which is best-effort on the far side of this intent.
  if (!state.batchRunId || !state.setId) return cleared;

  const scenarioRunId = state.scenarioRunId || ctx.key;

  return {
    state: { ...state, settled: true },
    nextWakeAt: null,
    intents: [
      ctx.intents.failRun(failRunMessageKey(scenarioRunId), {
        projectId: ctx.projectId,
        scenarioRunId,
        scenarioId: state.scenarioId,
        batchRunId: state.batchRunId,
        setId: state.setId,
        // A cancelled run reads as cancelled even when nobody honoured it;
        // anything else that went quiet is a stall, and it is now stored
        // rather than derived at read time.
        outcome: state.cancelRequested ? "cancelled" : "stalled",
        reason: state.cancelRequested
          ? "Cancelled — no worker reported the run finished within the cancellation window"
          : "Scenario run stopped reporting progress — the worker executing it is no longer alive",
      }),
    ],
  };
};
