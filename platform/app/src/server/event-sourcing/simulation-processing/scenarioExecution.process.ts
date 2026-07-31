import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import { CHILD_PROCESS } from "~/server/scenarios/scenario.constants";
import { scenarioFailureOutcomeSchema } from "~/server/scenarios/scenario-failure-outcome";
import type { simulationRunEvents } from "./events";

export const SCENARIO_EXECUTION_PROCESS_NAME = "scenarioExecution" as const;

/** A run may go quiet this long before it is declared dead — 2x the
 * child-process timeout, so a child hitting its own cap still has margin to
 * report the failure itself. */
export const SCENARIO_PROGRESS_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;
export const SCENARIO_DISPATCH_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;
const SCENARIO_DISPATCH_PER_SIBLING_MS = 30_000;
const SCENARIO_DISPATCH_DEADLINE_CAP_MS = 24 * 60 * 60 * 1000;
/** Cancellation is a Redis broadcast to a live child: either it lands in
 * seconds, or no amount of waiting produces a terminal event. */
export const SCENARIO_CANCEL_DEADLINE_MS = 60_000;

/** How long this run may sit queued, given how many siblings it queued with —
 * a batch drains at the pool's concurrency, so a fixed window either fires on
 * a healthy large batch or is too slack for a small abandoned one. */
export function dispatchDeadlineMsFor(batchTotal: number): number {
  const siblings =
    Number.isFinite(batchTotal) && batchTotal > 1 ? batchTotal - 1 : 0;
  return Math.min(
    SCENARIO_DISPATCH_DEADLINE_MS + siblings * SCENARIO_DISPATCH_PER_SIBLING_MS,
    SCENARIO_DISPATCH_DEADLINE_CAP_MS,
  );
}

export const scenarioExecutionTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});
export type ScenarioExecutionTarget = z.infer<
  typeof scenarioExecutionTargetSchema
>;

export const scenarioExecutionStateSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  /** `setId`, not the event's `scenarioSetId`: deployed
   * `ProcessManagerInstance.state` rows and in-flight outbox payloads spell it
   * this way, and a legacy row carries no state version to gate on — renaming
   * it would fail every in-flight instance's decode instead of migrating it. */
  setId: z.string(),
  target: scenarioExecutionTargetSchema.nullable(),
  cancelRequested: z.boolean(),
  settled: z.boolean(),
});
export type ScenarioExecutionState = z.infer<
  typeof scenarioExecutionStateSchema
>;

export function initScenarioExecutionState(): ScenarioExecutionState {
  return {
    scenarioRunId: "",
    scenarioId: "",
    batchRunId: "",
    setId: "",
    target: null,
    cancelRequested: false,
    settled: false,
  };
}

export const executeRunPayloadSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  target: scenarioExecutionTargetSchema,
});
export type ExecuteRunPayload = z.infer<typeof executeRunPayloadSchema>;

export const failRunPayloadSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  outcome: scenarioFailureOutcomeSchema,
  reason: z.string(),
});
export type FailRunPayload = z.infer<typeof failRunPayloadSchema>;

export interface ScenarioExecutionDispatchDeps {
  /** Runs the scenario and resolves when its child process is done. Rejects
   *  only for faults that happened before anything was spawned. */
  executeRun(job: {
    projectId: string;
    scenarioId: string;
    scenarioRunId: string;
    batchRunId: string;
    setId: string;
    target: ScenarioExecutionTarget;
  }): Promise<void>;
  /** The run's durable stored status — read fresh, never a fold cache, since a
   *  cached QUEUED is precisely the stale answer that lets a redelivery
   *  dispatch a scenario twice. */
  readRunStatus(params: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<string | null>;
  /** Writes the run's terminal event. Idempotent, so retrying this is safe. */
  emitFailure(params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId: string;
    error: string;
    outcome: string;
  }): Promise<void>;
}

const AWAITING_DISPATCH_STATUSES = new Set(["QUEUED", "PENDING"]);

export function scenarioExecutionIntents(deps: ScenarioExecutionDispatchDeps) {
  return {
    executeRun: {
      payload: executeRunPayloadSchema,
      messageKey: (payload) => `execute:${payload.scenarioRunId}`,
      async deliver(payload) {
        const status = await deps.readRunStatus({
          projectId: payload.projectId,
          scenarioRunId: payload.scenarioRunId,
        });
        // Anything past QUEUED/PENDING means a previous dispatch already
        // reached the run — re-executing bills the customer twice.
        if (status !== null && !AWAITING_DISPATCH_STATUSES.has(status)) return;

        try {
          await deps.executeRun(payload);
        } catch (error) {
          // Once handed to the executor this never throws again — a
          // rejection here would re-lease a message whose scenario already
          // spent money, so a post-dispatch fault is recorded as a terminal
          // failure instead of retried.
          await deps.emitFailure({
            ...payload,
            error: error instanceof Error ? error.message : String(error),
            outcome: "error",
          });
        }
      },
    } satisfies IntentDef<typeof executeRunPayloadSchema>,
    failRun: {
      payload: failRunPayloadSchema,
      messageKey: (payload) => `fail:${payload.scenarioRunId}`,
      deliver: (payload) =>
        deps.emitFailure({ ...payload, error: payload.reason }),
    } satisfies IntentDef<typeof failRunPayloadSchema>,
  };
}
type ScenarioExecutionIntents = ReturnType<typeof scenarioExecutionIntents>;

function withIdentities(
  state: ScenarioExecutionState,
  data: {
    scenarioRunId?: string;
    scenarioId?: string;
    batchRunId?: string;
    scenarioSetId?: string;
  },
  ctx: ProcessContext,
): ScenarioExecutionState {
  return {
    ...state,
    scenarioRunId: state.scenarioRunId || data.scenarioRunId || ctx.processKey,
    scenarioId: state.scenarioId || data.scenarioId || "",
    batchRunId: state.batchRunId || data.batchRunId || "",
    setId: state.setId || data.scenarioSetId || "",
  };
}

/** Once a cancel is requested every later arming uses the (shorter of the two)
 * cancel window, so a child streaming its last message before honouring
 * SIGTERM cannot push a cancelled run's deadline back out with progress
 * events. Terminal runs never re-arm. */
function armed(
  state: ScenarioExecutionState,
  args: { ctx: ProcessContext; occurredAt: number; windowMs: number },
): EvolveStep<ScenarioExecutionState, ScenarioExecutionIntents> {
  if (state.settled) return { state, intents: [], nextWakeAt: null };
  const { ctx, occurredAt, windowMs } = args;
  const effectiveMs = state.cancelRequested
    ? Math.min(windowMs, SCENARIO_CANCEL_DEADLINE_MS)
    : windowMs;
  return {
    state,
    intents: [],
    nextWakeAt: Math.max(occurredAt, ctx.now) + effectiveMs,
  };
}

function refreshDeadline(
  state: ScenarioExecutionState,
  args: { scenarioRunId: string; occurredAt: number; ctx: ProcessContext },
): EvolveStep<ScenarioExecutionState, ScenarioExecutionIntents> {
  const { scenarioRunId, occurredAt, ctx } = args;
  const next = withIdentities(state, { scenarioRunId }, ctx);
  return armed(next, {
    ctx,
    occurredAt,
    windowMs: SCENARIO_PROGRESS_DEADLINE_MS,
  });
}

export const scenarioExecutionOn: ProcessManagerHandlerMap<
  typeof simulationRunEvents,
  ScenarioExecutionState,
  ScenarioExecutionIntents
> = {
  queued(state, data, ctx) {
    const next = withIdentities(state, data, ctx);
    const target = data.target ?? null;
    const withTarget = { ...next, target: next.target ?? target };
    const evolution = armed(withTarget, {
      ctx,
      occurredAt: data.occurredAt,
      windowMs: dispatchDeadlineMsFor(data.batchTotal ?? 0),
    });
    if (withTarget.settled || !withTarget.target) return evolution;

    const scenarioRunId = withTarget.scenarioRunId || ctx.processKey;
    return {
      ...evolution,
      intents: [
        {
          type: "executeRun",
          payload: {
            projectId: ctx.tenantId,
            scenarioRunId,
            scenarioId: withTarget.scenarioId,
            batchRunId: withTarget.batchRunId,
            setId: withTarget.setId,
            target: withTarget.target,
          },
        },
      ],
    };
  },
  started(state, data, ctx) {
    return refreshDeadline(state, {
      scenarioRunId: data.scenarioRunId,
      occurredAt: data.occurredAt,
      ctx,
    });
  },
  messageSnapshot(state, data, ctx) {
    return refreshDeadline(state, {
      scenarioRunId: data.scenarioRunId,
      occurredAt: data.occurredAt,
      ctx,
    });
  },
  textMessageStart(state, data, ctx) {
    return refreshDeadline(state, {
      scenarioRunId: data.scenarioRunId,
      occurredAt: data.occurredAt,
      ctx,
    });
  },
  textMessageEnd(state, data, ctx) {
    return refreshDeadline(state, {
      scenarioRunId: data.scenarioRunId,
      occurredAt: data.occurredAt,
      ctx,
    });
  },
  cancelRequested(state, data, ctx) {
    const next = withIdentities(
      state,
      { scenarioRunId: data.scenarioRunId },
      ctx,
    );
    return armed(
      { ...next, cancelRequested: true },
      {
        ctx,
        occurredAt: data.occurredAt,
        windowMs: SCENARIO_CANCEL_DEADLINE_MS,
      },
    );
  },
  finished(state, data, ctx) {
    return {
      state: {
        ...withIdentities(state, { scenarioRunId: data.scenarioRunId }, ctx),
        settled: true,
      },
      intents: [],
      nextWakeAt: null,
    };
  },
  deleted(state, data, ctx) {
    return {
      state: {
        ...withIdentities(state, { scenarioRunId: data.scenarioRunId }, ctx),
        settled: true,
      },
      intents: [],
      nextWakeAt: null,
    };
  },
};

export function scenarioExecutionOnWake(
  state: ScenarioExecutionState,
  ctx: ProcessContext,
): EvolveStep<ScenarioExecutionState, ScenarioExecutionIntents> {
  const cleared: EvolveStep<ScenarioExecutionState, ScenarioExecutionIntents> =
    {
      state,
      intents: [],
      nextWakeAt: null,
    };
  if (state.settled) return cleared;
  // No placement fields to address a failure at, or nothing has folded for
  // this instance at all — clearing rather than retrying stops the wake
  // worker re-finding it forever.
  if (!state.batchRunId || !state.setId) return cleared;

  const scenarioRunId = state.scenarioRunId || ctx.processKey;
  return {
    state: { ...state, settled: true },
    nextWakeAt: null,
    intents: [
      {
        type: "failRun",
        payload: {
          projectId: ctx.tenantId,
          scenarioRunId,
          scenarioId: state.scenarioId,
          batchRunId: state.batchRunId,
          setId: state.setId,
          outcome: state.cancelRequested ? "cancelled" : "stalled",
          reason: state.cancelRequested
            ? "Cancelled — no worker reported the run finished within the cancellation window"
            : "Scenario run stopped reporting progress — the worker executing it is no longer alive",
        },
      },
    ],
  };
}
