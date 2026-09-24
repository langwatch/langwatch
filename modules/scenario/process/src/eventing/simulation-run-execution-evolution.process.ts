import type {
  EventHandler,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessIntent,
  WakeHandler,
} from "@langwatch/eventing";
import {
  runAwaitsEvaluations,
  runParameterValuesSchema,
  runSecretCiphertextSchema,
  ScenarioRunStatus,
} from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { z } from "zod";

import {
  CANCEL_GRACE_MS,
  EVALUATION_DEADLINE_MS,
  EVALUATION_LOST_DETAILS,
  type PendingEvaluator,
  pendingEvaluatorSchema,
  type SimulationRunExecutionIntents,
  type SimulationRunExecutionProcessState,
  type SimulationRunProcessEventView,
  simulationRunProcessEventViewSchema,
} from "./simulation-run-execution-data.process.ts";

/** A run is stalled only after twice the isolated child hard timeout. */
export const STALL_THRESHOLD_MS = 30 * 60 * 1000;

const unknownRecordSchema = z.record(z.string(), z.unknown());
const pendingEvaluatorsSchema = z.array(pendingEvaluatorSchema);
const secretParameterNamesSchema = z.array(z.string());

/**
 * Simulation run execution process (ADR-052): pure state logic per run.
 * Replaces fire-and-forget subscriber; outbox owns retry, wake owns backstops.
 */

type Ctx = ProcessHandlerContext<SimulationRunExecutionIntents>;

/** Deterministic outbox identities (unique per process instance). */
const executeKey = (scenarioRunId: string) => `execute:${scenarioRunId}`;
const cancelKey = (scenarioRunId: string) => `cancel:${scenarioRunId}`;
const finishCancelledKey = (scenarioRunId: string) => `finish:${scenarioRunId}:cancelled`;
const finishStalledKey = (scenarioRunId: string) => `finish:${scenarioRunId}:stalled`;
const finishUnexecutableKey = (scenarioRunId: string) => `finish:${scenarioRunId}:unexecutable`;
const recordEvaluationsLostKey = (scenarioRunId: string) =>
  `record_evaluations:${scenarioRunId}:lost`;

/**
 * Content boundary: narrows pipeline event to identities/enums/timestamps.
 * Keeps only parameter values, drops all conversation content and enriched fields.
 */
type SimulationRunPayloadEvent = Pick<SimulationProcessingEvent, "type" | "occurredAt"> & {
  data: unknown;
};

export const handleRunQueued: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state, payload, ctx) => {
  const view = simulationRunProcessEventViewSchema.parse(payload);

  // Queued opens the stream. Anything after the process is initialized (or
  // already terminal) is a redelivery — the outbox would dedup a re-emitted
  // execute intent by messageKey anyway, but re-stamping state and wakes is
  // pure churn.
  if (state.scenarioRunId !== "" || state.phase === "terminal") {
    return { state, nextWakeAt: SimulationRunExecutionEvolution.currentWake(state) };
  }

  const refMs = SimulationRunExecutionEvolution.schedulingRef(ctx);
  const base: SimulationRunExecutionProcessState = {
    projectId: ctx.projectId,
    scenarioRunId: ctx.key,
    phase: "queued",
    // Business time: a record of when the run was queued, not a deadline.
    queuedAtMs: ctx.at,
    // Scheduling time, the same clock `handleRunActivity` stamps and the wake
    // measures against. Storing `ctx.at` here would let a backed-up subscriber's
    // stale business time make a run that just started look already stalled.
    lastActivityAtMs: refMs,
    cancelRequestedAtMs: state.cancelRequestedAtMs,
    finishedAtMs: null,
    pendingEvaluators: null,
    evaluationsRecorded: state.evaluationsRecorded,
  };

  if (state.cancelRequestedAtMs !== null) {
    // Defensive: the cancel was recorded before the queued event reached
    // this process. Never submit to the pool; finish CANCELLED straight
    // away, with the grace wake as the lost-dispatch backstop.
    return {
      state: { ...base, phase: "cancelling" },
      nextWakeAt: ctx.now + CANCEL_GRACE_MS,
      intents: [SimulationRunExecutionEvolution.finishCancelledIntent(ctx)],
    };
  }

  // The queued event predates the execution target (or lost its identity):
  // there is nothing to submit. Failing the run now beats pinning it until
  // the stall wake — a run that can never start is not "stalled", it is
  // unexecutable.
  if (
    view.scenarioId === null ||
    view.batchRunId === null ||
    view.scenarioSetId === null ||
    view.target === null
  ) {
    return SimulationRunExecutionEvolution.finishUnexecutable({
      ctx,
      base,
      error: "queued event carries no execution target",
    });
  }

  // Fail closed on a secret the run cannot deliver. The run was started for a
  // target that authenticates with this credential, so executing it without
  // one, or with the project value of the same name, reports a result about
  // the credential rather than about the scenario.
  const missingSecrets = SimulationRunExecutionEvolution.declaredSecretsWithoutCiphertext(view);
  if (missingSecrets.length > 0) {
    return SimulationRunExecutionEvolution.finishUnexecutable({
      ctx,
      base,
      error: `queued event carries no value for secret parameters: ${missingSecrets.join(", ")}`,
    });
  }

  return {
    state: base,
    nextWakeAt: refMs + STALL_THRESHOLD_MS,
    intents: [
      ctx.intents.execute(executeKey(ctx.key), {
        scenarioRunId: ctx.key,
        projectId: ctx.projectId,
        scenarioId: view.scenarioId,
        batchRunId: view.batchRunId,
        scenarioSetId: view.scenarioSetId,
        ...(view.name !== null ? { name: view.name } : {}),
        target: view.target,
        ...(view.parameters !== null ? { parameters: view.parameters } : {}),
        ...(view.secretParameters !== null ? { secretParameters: view.secretParameters } : {}),
      }),
    ],
  };
};

/** Any sign of life: the run is making progress, re-arm the stall deadline. */
export const handleRunActivity: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state, _payload, ctx) => {
  if (state.phase === "terminal") {
    return { state, nextWakeAt: null };
  }
  if (state.phase === "cancelling" || state.phase === "evaluating") {
    // The child is being torn down, or the run is over and only its
    // evaluators are outstanding; activity no longer resets anything, but the
    // grace or deadline wake must survive.
    return { state, nextWakeAt: SimulationRunExecutionEvolution.currentWake(state) };
  }
  const refMs = SimulationRunExecutionEvolution.schedulingRef(ctx);
  return {
    state: { ...state, phase: "running", lastActivityAtMs: refMs },
    nextWakeAt: refMs + STALL_THRESHOLD_MS,
  };
};

export const handleCancelRequested: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state, _payload, ctx) => {
  switch (state.phase) {
    case "queued": {
      // No child running, go terminal now. Still need broadcast if submitted.
      // Pool may hold job in prefetch; pool.wasCancelled stops it spawning.
      const wasSubmitted = state.scenarioRunId !== "";
      return {
        state: {
          ...state,
          phase: "terminal",
          cancelRequestedAtMs: ctx.at,
        },
        nextWakeAt: null,
        intents: wasSubmitted
          ? [
              ctx.intents.cancel(cancelKey(ctx.key), {
                scenarioRunId: ctx.key,
                projectId: ctx.projectId,
              }),
              SimulationRunExecutionEvolution.finishCancelledIntent(ctx),
            ]
          : [SimulationRunExecutionEvolution.finishCancelledIntent(ctx)],
      };
    }
    case "running":
      // The child may live on another pod: broadcast the cancel through the
      // outbox (retried), and arm the grace wake as the backstop for a lost
      // pub/sub message.
      return {
        state: {
          ...state,
          phase: "cancelling",
          cancelRequestedAtMs: ctx.at,
        },
        nextWakeAt: ctx.now + CANCEL_GRACE_MS,
        intents: [
          ctx.intents.cancel(cancelKey(ctx.key), {
            scenarioRunId: ctx.key,
            projectId: ctx.projectId,
          }),
        ],
      };
    default:
      // terminal / cancelling: no-op, keep the existing wake.
      return { state, nextWakeAt: SimulationRunExecutionEvolution.currentWake(state) };
  }
};

/** DELETED: the run reached a recorded terminal state. */
export const handleTerminal: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state) => ({
  state: { ...state, phase: "terminal" },
  nextWakeAt: null,
  intents: [],
});

/**
 * FINISHED: conversation over. Run owing evaluator results waits in `evaluating`;
 * others go terminal. Rule is runAwaitsEvaluations, matching PENDING_EVALUATION state.
 */
export const handleRunFinished: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state, payload, ctx) => {
  // A run finishes exactly once: a redelivered finished event must not re-arm
  // a deadline the evaluated event already cleared, nor push one back.
  if (state.phase === "terminal" || state.phase === "evaluating") {
    return { state, nextWakeAt: SimulationRunExecutionEvolution.currentWake(state) };
  }

  const view = simulationRunProcessEventViewSchema.parse(payload);
  const evaluators = view.evaluators ?? [];
  const awaitsEvaluations =
    !state.evaluationsRecorded &&
    runAwaitsEvaluations({
      status: view.status?.toUpperCase(),
      hasOwnEvaluations: view.hasOwnEvaluations,
      attachmentCount: evaluators.length,
    });
  if (!awaitsEvaluations) {
    return { state: { ...state, phase: "terminal" }, nextWakeAt: null };
  }

  const refMs = SimulationRunExecutionEvolution.schedulingRef(ctx);
  return {
    state: {
      ...state,
      phase: "evaluating",
      // Finishing is the run's last sign of life. Stamped so the wake's
      // untouched-process guard does not clear a deadline for a run whose
      // finished event is the only one this process ever saw.
      lastActivityAtMs: refMs,
      finishedAtMs: refMs,
      pendingEvaluators: evaluators,
    },
    nextWakeAt: refMs + EVALUATION_DEADLINE_MS,
  };
};

/**
 * EVALUATED: the results are in. A run waiting on them goes terminal and its
 * deadline clears. A run not yet finished (business time can land this event
 * first) records that they arrived, so its finished event goes terminal too.
 */
export const handleRunEvaluated: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state) => {
  if (state.phase === "terminal") {
    return { state, nextWakeAt: null };
  }
  const recorded = { ...state, evaluationsRecorded: true };
  if (state.phase === "evaluating") {
    return {
      state: { ...recorded, phase: "terminal" as const, pendingEvaluators: null },
      nextWakeAt: null,
    };
  }
  return { state: recorded, nextWakeAt: SimulationRunExecutionEvolution.currentWake(state) };
};

export const simulationRunExecutionWake: WakeHandler<
  SimulationRunExecutionProcessState,
  SimulationRunExecutionIntents
> = (state, ctx) => {
  if (state.phase === "terminal") {
    return { state, nextWakeAt: null, intents: [] };
  }

  // Wake for untouched process must clear itself. scenarioRunId doesn't mean untouched;
  // external runs open with STARTED; stall decision needs no state from id.
  if (state.scenarioRunId === "" && state.lastActivityAtMs === 0) {
    return { state, nextWakeAt: null, intents: [] };
  }

  if (state.phase === "cancelling") {
    const requestedAtMs = state.cancelRequestedAtMs ?? ctx.now;
    if (ctx.now - requestedAtMs >= CANCEL_GRACE_MS) {
      // The cancel broadcast never produced a terminal event — the owning
      // pod was down or the pub/sub message was lost. Same messageKey as the
      // cancel-requested path: the outbox dedups if that one dispatched.
      return {
        state: { ...state, phase: "terminal" },
        nextWakeAt: null,
        intents: [SimulationRunExecutionEvolution.finishCancelledIntent(ctx)],
      };
    }
    return { state, nextWakeAt: requestedAtMs + CANCEL_GRACE_MS };
  }

  if (state.phase === "evaluating") {
    return SimulationRunExecutionEvolution.wakeEvaluating(state, ctx);
  }

  // queued | running
  if (ctx.now - state.lastActivityAtMs >= STALL_THRESHOLD_MS) {
    // Replaces read-time stall derivation: the stall is now a recorded,
    // durable outcome instead of something every read recomputes.
    return {
      state: { ...state, phase: "terminal" },
      nextWakeAt: null,
      intents: [
        ctx.intents.finish(finishStalledKey(ctx.key), {
          scenarioRunId: ctx.key,
          projectId: ctx.projectId,
          status: ScenarioRunStatus.ERROR,
          error: "stalled",
        }),
      ],
    };
  }
  return { state, nextWakeAt: state.lastActivityAtMs + STALL_THRESHOLD_MS };
};

/**
 * Simulation run execution evolution: how it moves and when given up on.
 * Members public: handlers registered by process builder from outside.
 */
export class SimulationRunExecutionEvolution {
  /**
   * Re-derive the wake a no-op must keep. The runtime maps an omitted
   * `nextWakeAt` to null (it CLEARS the wake), so "leave the wake alone" has
   * to be stated explicitly.
   */
  static currentWake(state: SimulationRunExecutionProcessState): number | null {
    switch (state.phase) {
      case "terminal":
        return null;
      case "cancelling":
        return state.cancelRequestedAtMs === null
          ? null
          : state.cancelRequestedAtMs + CANCEL_GRACE_MS;
      case "evaluating":
        return state.finishedAtMs === null ? null : state.finishedAtMs + EVALUATION_DEADLINE_MS;
      default:
        return state.lastActivityAtMs + STALL_THRESHOLD_MS;
    }
  }

  static finishCancelledIntent(ctx: Ctx): ProcessIntent {
    return ctx.intents.finish(finishCancelledKey(ctx.key), {
      scenarioRunId: ctx.key,
      projectId: ctx.projectId,
      status: ScenarioRunStatus.CANCELLED,
    });
  }

  /**
   * Clamp the scheduling reference to the present. `ctx.at` is business time,
   * so a backed-up subscriber's event can already be past its stall deadline;
   * scheduling from it would stall the run the moment the wake worker looks.
   */
  static schedulingRef(ctx: Ctx): number {
    return Math.max(ctx.at, ctx.now);
  }

  /**
   * The declared secret names the queued event has no usable ciphertext for:
   * missing when the ciphertext record has no entry, or an empty one. An
   * event declaring nothing secret returns nothing, same as before secrets.
   */
  static declaredSecretsWithoutCiphertext(view: SimulationRunProcessEventView): string[] {
    if (view.secretParameterNames === null) return [];
    const ciphertext = view.secretParameters ?? {};
    return view.secretParameterNames.filter((name) => (ciphertext[name] ?? "").length === 0);
  }

  /** Finishes the run ERROR without submitting it, and clears every wake. */
  static finishUnexecutable({
    ctx,
    base,
    error,
  }: {
    ctx: Ctx;
    base: SimulationRunExecutionProcessState;
    error: string;
  }): ProcessEvolution<SimulationRunExecutionProcessState> {
    return {
      state: { ...base, phase: "terminal" as const },
      nextWakeAt: null,
      intents: [
        ctx.intents.finish(finishUnexecutableKey(ctx.key), {
          scenarioRunId: ctx.key,
          projectId: ctx.projectId,
          status: ScenarioRunStatus.ERROR,
          error,
        }),
      ],
    };
  }

  /**
   * The wake of a run waiting on its evaluators. Past the deadline with no
   * evaluated event, the job was lost outright, so one errored result per
   * evaluator hands the decision to the gate: required fails, optional leaves it.
   */
  static wakeEvaluating(
    state: SimulationRunExecutionProcessState,
    ctx: Parameters<
      WakeHandler<SimulationRunExecutionProcessState, SimulationRunExecutionIntents>
    >[1],
  ): ProcessEvolution<SimulationRunExecutionProcessState> {
    const finishedAtMs = state.finishedAtMs ?? ctx.now;
    if (ctx.now - finishedAtMs < EVALUATION_DEADLINE_MS) {
      return { state, nextWakeAt: finishedAtMs + EVALUATION_DEADLINE_MS };
    }
    return {
      state: { ...state, phase: "terminal" as const, pendingEvaluators: null },
      nextWakeAt: null,
      intents: [
        ctx.intents.record_evaluations(recordEvaluationsLostKey(ctx.key), {
          scenarioRunId: ctx.key,
          projectId: ctx.projectId,
          evaluators: state.pendingEvaluators ?? [],
          details: EVALUATION_LOST_DETAILS,
        }),
      ],
    };
  }

  /**
   * The evaluators a finished event says the run is graded with, narrowed to
   * ids and required flags. Null when absent or unreadable: the fold and the
   * job share a schema, so what the process can't watch isn't queued for it.
   */
  static pendingEvaluatorsOf(data: Record<string, unknown>): PendingEvaluator[] | null {
    const parsedEvaluators = unknownRecordSchema.safeParse(data.evaluators);
    if (!parsedEvaluators.success) return null;
    const parsed = pendingEvaluatorsSchema.safeParse(parsedEvaluators.data.attachments);
    return parsed.success ? parsed.data : null;
  }

  static buildSimulationRunEventView(
    event: SimulationRunPayloadEvent,
  ): SimulationRunProcessEventView {
    const parsedData = unknownRecordSchema.safeParse(event.data);
    const data = parsedData.success ? parsedData.data : {};
    const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
    // Validated rather than cast. A cast lets any non-null object through as a
    // target, and the schema parse on the way back in then THROWS on it — so a
    // malformed target becomes a redelivering handler instead of a run that
    // fails once, clearly. Normalising to null instead hands handleRunQueued the
    // case it already has an answer for: finish the run as unexecutable.
    const parsedTarget = simulationRunProcessEventViewSchema.shape.target.safeParse(data.target);
    const target = parsedTarget.success ? parsedTarget.data : null;
    // The queued event is the only place the run's resolved parameter values
    // cross into execution: an unreadable shape is dropped rather than failing
    // the run, since a run without parameters is the behaviour every run had
    // before them.
    const parsedMetadata = unknownRecordSchema.safeParse(data.metadata);
    const metadata = parsedMetadata.success ? parsedMetadata.data : {};
    const parsedParameters = runParameterValuesSchema.safeParse(metadata.parameters);
    const parameters =
      parsedParameters.success && Object.keys(parsedParameters.data).length > 0
        ? parsedParameters.data
        : null;
    // Encrypted, and kept encrypted: this view is persisted verbatim into inbox
    // and outbox rows. It rides beside the metadata rather than inside it, so an
    // event written by a build that did not have it simply has nothing here.
    const parsedSecretParameters = runSecretCiphertextSchema.safeParse(data.secretParameters);
    const secretParameters =
      parsedSecretParameters.success && Object.keys(parsedSecretParameters.data).length > 0
        ? parsedSecretParameters.data
        : null;
    // The names ride the metadata in clear. They say what the ciphertext beside
    // them has to cover, so a queued event whose secret values were lost or
    // written by another CREDENTIALS_SECRET is caught before the run starts.
    const parsedSecretNames = secretParameterNamesSchema.safeParse(metadata.secretParameterNames);
    const secretParameterNames =
      parsedSecretNames.success && parsedSecretNames.data.length > 0
        ? parsedSecretNames.data
        : null;
    return {
      eventType: event.type,
      occurredAt: event.occurredAt,
      status: str(data.status),
      scenarioId: str(data.scenarioId),
      batchRunId: str(data.batchRunId),
      scenarioSetId: str(data.scenarioSetId),
      name: str(data.name),
      target,
      parameters,
      secretParameters,
      secretParameterNames,
      evaluators: SimulationRunExecutionEvolution.pendingEvaluatorsOf(data),
      hasOwnEvaluations: unknownRecordSchema.safeParse(data.results).data?.evaluations != null,
    };
  }
}
