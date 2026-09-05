import { z } from "zod";

import type {
  EventHandler,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import { runSecretCiphertextSchema } from "~/server/scenarios/run-secret-values";
import { STALL_THRESHOLD_MS } from "~/server/scenarios/scenario.constants";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { runAwaitsEvaluations } from "~/server/scenarios/scenario-run-evaluators";

import type { SimulationProcessingEvent } from "../schemas/events";
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
} from "./simulationRunExecutionProcess.types";

/**
 * The simulation run execution process (ADR-052), authored for the
 * `withProcessManager` builder: pure state logic only. One process instance
 * per scenario run (process key = scenarioRunId). It replaces the old
 * fire-and-forget execution subscriber, the ephemeral Redis-only cancellation
 * path, and read-time stall derivation with durable state: the outbox owns
 * dispatch retries, and the wake owns the stall, cancel-grace and
 * evaluation-deadline backstops.
 *
 * There is no `.schedule()` — wakes are per-run deadlines (stall threshold,
 * cancel grace, evaluation deadline), so every handler returns its own
 * explicit `nextWakeAt`.
 */

type Ctx = ProcessHandlerContext<SimulationRunExecutionIntents>;

/** Deterministic outbox identities (unique per process instance). */
const executeKey = (scenarioRunId: string) => `execute:${scenarioRunId}`;
const cancelKey = (scenarioRunId: string) => `cancel:${scenarioRunId}`;
const finishCancelledKey = (scenarioRunId: string) =>
  `finish:${scenarioRunId}:cancelled`;
const finishStalledKey = (scenarioRunId: string) =>
  `finish:${scenarioRunId}:stalled`;
const finishUnexecutableKey = (scenarioRunId: string) =>
  `finish:${scenarioRunId}:unexecutable`;
const recordEvaluationsLostKey = (scenarioRunId: string) =>
  `record_evaluations:${scenarioRunId}:lost`;

/**
 * The evaluators a finished event says the run is graded with, narrowed to
 * ids and required flags. Null when the event carries none, or a shape this
 * version cannot read: the fold and the job read the same field with the same
 * schema, so a run the process cannot watch is one the job is not queued for.
 */
function pendingEvaluatorsOf(
  data: Record<string, unknown>,
): PendingEvaluator[] | null {
  const evaluators = data.evaluators;
  if (typeof evaluators !== "object" || evaluators === null) return null;
  const parsed = z
    .array(pendingEvaluatorSchema)
    .safeParse((evaluators as Record<string, unknown>).attachments);
  return parsed.success ? parsed.data : null;
}

/**
 * The content boundary (`toPayload`): narrows a committed pipeline event to
 * the identities/enums/timestamps view the process is allowed to persist.
 *
 * Everything else is dropped here, before the runtime builds the envelope —
 * messages, results, verdict reasoning, criteria text, message content, and
 * all of `metadata` except the run's resolved parameter values. The process
 * manager persists this payload verbatim into inbox and outbox rows, so
 * anything this function keeps becomes durable. It keeps nothing that is
 * conversation content: the parameter values are customer-chosen run
 * configuration, already durable on the queued event itself.
 *
 * Reads three things off the finished event: `status`, the evaluator ids and
 * required flags it carries, and whether its results carry evaluations of
 * their own. The rest of the enriched finished-event fields are not read.
 */
export function buildSimulationRunEventView(
  event: SimulationProcessingEvent,
): SimulationRunProcessEventView {
  const data = event.data as Record<string, unknown>;
  const str = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  // Validated rather than cast. A cast lets any non-null object through as a
  // target, and the schema parse on the way back in then THROWS on it — so a
  // malformed target becomes a redelivering handler instead of a run that
  // fails once, clearly. Normalising to null instead hands handleRunQueued the
  // case it already has an answer for: finish the run as unexecutable.
  const parsedTarget =
    simulationRunProcessEventViewSchema.shape.target.safeParse(data.target);
  const target = parsedTarget.success ? parsedTarget.data : null;
  // The queued event is the only place the run's resolved parameter values
  // cross into execution: the pool job is otherwise built from ids, which do
  // not carry them. A shape this version cannot read is dropped rather than
  // failing the run — all or nothing, because half a record would run the
  // scenario against a value the caller never chose — and a run without
  // parameters is the behaviour every run had before them.
  const metadata =
    typeof data.metadata === "object" && data.metadata !== null
      ? (data.metadata as Record<string, unknown>)
      : undefined;
  const parsedParameters = runParameterValuesSchema.safeParse(
    metadata?.parameters,
  );
  const parameters =
    parsedParameters.success && Object.keys(parsedParameters.data).length > 0
      ? parsedParameters.data
      : null;
  // Encrypted, and kept encrypted: this view is persisted verbatim into inbox
  // and outbox rows. It rides beside the metadata rather than inside it, so an
  // event written by a build that did not have it simply has nothing here.
  const parsedSecretParameters = runSecretCiphertextSchema.safeParse(
    data.secretParameters,
  );
  const secretParameters =
    parsedSecretParameters.success &&
    Object.keys(parsedSecretParameters.data).length > 0
      ? parsedSecretParameters.data
      : null;
  // The names ride the metadata in clear. They say what the ciphertext beside
  // them has to cover, so a queued event whose secret values were lost or
  // written by another CREDENTIALS_SECRET is caught before the run starts.
  const parsedSecretNames = z
    .array(z.string())
    .safeParse(metadata?.secretParameterNames);
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
    evaluators: pendingEvaluatorsOf(data),
    hasOwnEvaluations:
      typeof data.results === "object" &&
      data.results !== null &&
      (data.results as Record<string, unknown>).evaluations != null,
  };
}

/**
 * Re-derive the wake a no-op must keep. The runtime maps an omitted
 * `nextWakeAt` to null (it CLEARS the wake), so "leave the wake alone" has
 * to be stated explicitly.
 */
function currentWake(state: SimulationRunExecutionProcessState): number | null {
  switch (state.phase) {
    case "terminal":
      return null;
    case "cancelling":
      return state.cancelRequestedAtMs === null
        ? null
        : state.cancelRequestedAtMs + CANCEL_GRACE_MS;
    case "evaluating":
      return state.finishedAtMs === null
        ? null
        : state.finishedAtMs + EVALUATION_DEADLINE_MS;
    default:
      return state.lastActivityAtMs + STALL_THRESHOLD_MS;
  }
}

function finishCancelledIntent(ctx: Ctx) {
  return ctx.intents.finish(finishCancelledKey(ctx.key), {
    scenarioRunId: ctx.key,
    projectId: ctx.projectId,
    status: ScenarioRunStatus.CANCELLED,
  });
}

/**
 * Clamp the scheduling reference to the present. `ctx.at` is business time,
 * so a backed-up subscriber can deliver an event whose stall deadline has
 * ALREADY passed; scheduling from it writes a nextWakeAt in the past and the
 * run is declared stalled the moment the wake worker sees it.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * The declared secret names the queued event carries no usable ciphertext for.
 *
 * An event that declares nothing secret returns nothing, which is the shape
 * every run had before secret parameters and the shape an older event has.
 * A name is missing when the ciphertext record has no entry for it, or holds
 * an empty one.
 */
function declaredSecretsWithoutCiphertext(
  view: SimulationRunProcessEventView,
): string[] {
  if (view.secretParameterNames === null) return [];
  const ciphertext = view.secretParameters ?? {};
  return view.secretParameterNames.filter(
    (name) => (ciphertext[name] ?? "").length === 0,
  );
}

/** Finishes the run ERROR without submitting it, and clears every wake. */
function finishUnexecutable({
  ctx,
  base,
  error,
}: {
  ctx: Ctx;
  base: SimulationRunExecutionProcessState;
  error: string;
}) {
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
    return { state, nextWakeAt: currentWake(state) };
  }

  const refMs = schedulingRef(ctx);
  const base: SimulationRunExecutionProcessState = {
    projectId: ctx.projectId,
    scenarioRunId: ctx.key,
    phase: "queued",
    // Business time: a record of when the run was queued, not a deadline.
    queuedAtMs: ctx.at,
    // Scheduling time, the same clock `handleRunActivity` stamps and the same
    // one the wake measures against. Storing `ctx.at` here would reintroduce
    // exactly what schedulingRef exists to stop: a backed-up subscriber
    // delivers a queued event whose business time is already older than the
    // stall threshold, and the first wake declares a run that just started
    // stalled.
    lastActivityAtMs: refMs,
    cancelRequestedAtMs: state.cancelRequestedAtMs,
    finishedAtMs: null,
    pendingEvaluators: null,
    evaluationsRecorded: state.evaluationsRecorded ?? false,
  };

  if (state.cancelRequestedAtMs !== null) {
    // Defensive: the cancel was recorded before the queued event reached
    // this process. Never submit to the pool; finish CANCELLED straight
    // away, with the grace wake as the lost-dispatch backstop.
    return {
      state: { ...base, phase: "cancelling" },
      nextWakeAt: ctx.now + CANCEL_GRACE_MS,
      intents: [finishCancelledIntent(ctx)],
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
    return finishUnexecutable({
      ctx,
      base,
      error: "queued event carries no execution target",
    });
  }

  // Fail closed on a secret the run cannot deliver. The run was started for a
  // target that authenticates with this credential, so executing it without
  // one, or with the project value of the same name, reports a result about
  // the credential rather than about the scenario.
  const missingSecrets = declaredSecretsWithoutCiphertext(view);
  if (missingSecrets.length > 0) {
    return finishUnexecutable({
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
        ...(view.secretParameters !== null
          ? { secretParameters: view.secretParameters }
          : {}),
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
    return { state, nextWakeAt: currentWake(state) };
  }
  const refMs = schedulingRef(ctx);
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
      // No child is running, so the run goes terminal now instead of waiting
      // out the grace window.
      //
      // It still needs the broadcast if it was ever submitted. `queued` does
      // not mean "not dispatched": the execute intent goes out the moment
      // the run is queued, so the pool may already hold this job — buffered
      // behind a busy slot, or in prefetch — and `pool.wasCancelled`, which
      // is what stops it spawning, is set by the cancellation subscriber and
      // by nothing else. Without the broadcast the run reads CANCELLED while
      // the scenario runs to completion and bills for it.
      //
      // An uninitialized process (the cancel overtook the queued event) never
      // emitted execute, so there is nothing to call off.
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
              finishCancelledIntent(ctx),
            ]
          : [finishCancelledIntent(ctx)],
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
      return { state, nextWakeAt: currentWake(state) };
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
 * FINISHED: the conversation is over. A run that owes its evaluator results
 * is not terminal yet: it waits in `evaluating` under the evaluation deadline,
 * carrying the evaluators it owes, until the evaluated event lands or the
 * wake records the lost job. Every other run goes terminal here.
 *
 * The rule is the fold's own (`runAwaitsEvaluations`), read off the same
 * fields of the same event, so a run stored PENDING_EVALUATION is exactly a
 * run this process is watching.
 */
export const handleRunFinished: EventHandler<
  SimulationRunExecutionProcessState,
  unknown,
  SimulationRunExecutionIntents
> = (state, payload, ctx) => {
  // A run finishes exactly once: a redelivered finished event must not
  // re-arm a deadline the evaluated event already cleared, nor push one back.
  if (state.phase === "terminal" || state.phase === "evaluating") {
    return { state, nextWakeAt: currentWake(state) };
  }

  const view = simulationRunProcessEventViewSchema.parse(payload);
  const evaluators = view.evaluators ?? [];
  const awaitsEvaluations =
    !(state.evaluationsRecorded ?? false) &&
    runAwaitsEvaluations({
      status: view.status?.toUpperCase(),
      hasOwnEvaluations: view.hasOwnEvaluations,
      attachmentCount: evaluators.length,
    });
  if (!awaitsEvaluations) {
    return { state: { ...state, phase: "terminal" }, nextWakeAt: null };
  }

  const refMs = schedulingRef(ctx);
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
 * deadline is cleared. A run that has not finished yet (business time can
 * land the evaluated event first) records that they are in, so its finished
 * event goes terminal instead of waiting on nothing.
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
      state: { ...recorded, phase: "terminal", pendingEvaluators: null },
      nextWakeAt: null,
    };
  }
  return { state: recorded, nextWakeAt: currentWake(state) };
};

export const simulationRunExecutionWake: WakeHandler<
  SimulationRunExecutionProcessState,
  SimulationRunExecutionIntents
> = (state, ctx) => {
  if (state.phase === "terminal") {
    return { state, nextWakeAt: null, intents: [] };
  }

  // A wake for a process no event ever touched decides nothing and must
  // clear itself, or the wake worker re-finds it forever.
  //
  // `scenarioRunId` alone does not mean untouched: only handleRunQueued
  // stamps it, and QUEUED is platform-only. A run reported from outside
  // (an SDK batch on a customer machine) opens with STARTED, so its
  // process carries real activity while the id stays blank — and the
  // stall decision below needs nothing from state, the finish intent is
  // built from the process key and project the wake carries. Requiring
  // the id here disarmed the watchdog for every externally reported run,
  // which then read IN_PROGRESS forever when its process died.
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
        intents: [finishCancelledIntent(ctx)],
      };
    }
    return { state, nextWakeAt: requestedAtMs + CANCEL_GRACE_MS };
  }

  if (state.phase === "evaluating") {
    const finishedAtMs = state.finishedAtMs ?? ctx.now;
    if (ctx.now - finishedAtMs >= EVALUATION_DEADLINE_MS) {
      // The evaluated event never came: the grading job was lost outright,
      // since a job that runs records a result for every evaluator on its
      // final attempt. Recording one errored result per evaluator hands the
      // decision to the gate: a required evaluator fails the run, an optional
      // one leaves the judge's verdict.
      return {
        state: { ...state, phase: "terminal", pendingEvaluators: null },
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
    return { state, nextWakeAt: finishedAtMs + EVALUATION_DEADLINE_MS };
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
