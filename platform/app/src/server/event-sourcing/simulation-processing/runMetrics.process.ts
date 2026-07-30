import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import type { simulationRunEvents } from "./events";

export const RUN_METRICS_PROCESS_NAME = "runMetrics" as const;

/** A run's traces settle a little after it finishes; measuring immediately
 * reads a half-written trace. */
export const RUN_METRICS_SETTLE_PERIOD_MS = 60_000;
/** Re-measure delays after a measurement came back with nothing to record —
 * the only signal that separates "measured too early" from "measured". */
export const RUN_METRICS_REMEASURE_DELAYS_MS = [120_000, 900_000] as const;
export const RUN_METRICS_MAX_MEASUREMENTS =
  RUN_METRICS_REMEASURE_DELAYS_MS.length + 1;

export const runMetricsStateSchema = z.object({
  scenarioRunId: z.string(),
  deadlineAt: z.number().nullable(),
  attempts: z.number().int().nonnegative(),
  measured: z.boolean(),
  deleted: z.boolean(),
});
export type RunMetricsState = z.infer<typeof runMetricsStateSchema>;

export function initRunMetricsState(): RunMetricsState {
  return {
    scenarioRunId: "",
    deadlineAt: null,
    attempts: 0,
    measured: false,
    deleted: false,
  };
}

export const computeRunMetricsPayloadSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  /** Which measurement this is for the run — in the key so a re-measure's
   *  intent never collides with (and gets suppressed by) an earlier one's. */
  attempt: z.number().int().positive(),
});
export type ComputeRunMetricsPayload = z.infer<
  typeof computeRunMetricsPayloadSchema
>;

export interface RunMetricsDispatchDeps {
  /** Derives the run's cost/latency from its traces and records them via this
   *  pipeline's own `recordMetrics` command — a cross-pipeline read the
   *  composition root bridges, never this process's own concern. */
  computeRunMetrics(data: {
    tenantId: string;
    scenarioRunId: string;
    occurredAt: number;
  }): Promise<void>;
}

export function computeRunMetricsIntents(deps: RunMetricsDispatchDeps) {
  return {
    computeRunMetrics: {
      payload: computeRunMetricsPayloadSchema,
      messageKey: (payload) =>
        `measure:${payload.scenarioRunId}:${payload.attempt}`,
      deliver: (payload) =>
        deps.computeRunMetrics({
          tenantId: payload.tenantId,
          scenarioRunId: payload.scenarioRunId,
          occurredAt: Date.now(),
        }),
    } satisfies IntentDef<typeof computeRunMetricsPayloadSchema>,
  };
}
type RunMetricsIntents = ReturnType<typeof computeRunMetricsIntents>;

function withRunId(
  state: RunMetricsState,
  scenarioRunId: string,
  ctx: ProcessContext,
): RunMetricsState {
  return {
    ...state,
    scenarioRunId: state.scenarioRunId || scenarioRunId || ctx.processKey,
  };
}

export const runMetricsOn: ProcessManagerHandlerMap<
  typeof simulationRunEvents,
  RunMetricsState,
  RunMetricsIntents
> = {
  finished(state, data, ctx): EvolveStep<RunMetricsState, RunMetricsIntents> {
    const seen = withRunId(state, data.scenarioRunId, ctx);
    if (
      seen.deleted ||
      seen.measured ||
      seen.attempts > 0 ||
      seen.deadlineAt !== null
    ) {
      return { state: seen, intents: [], nextWakeAt: seen.deadlineAt };
    }
    if (!seen.scenarioRunId) {
      return {
        state: { ...seen, deadlineAt: null },
        intents: [],
        nextWakeAt: null,
      };
    }
    const deadlineAt =
      Math.max(data.occurredAt, ctx.now) + RUN_METRICS_SETTLE_PERIOD_MS;
    return {
      state: { ...seen, deadlineAt },
      intents: [],
      nextWakeAt: deadlineAt,
    };
  },
  deleted(state, data, ctx) {
    return {
      state: {
        ...withRunId(state, data.scenarioRunId, ctx),
        deleted: true,
        deadlineAt: null,
      },
      intents: [],
      nextWakeAt: null,
    };
  },
  // The run's own measurement, read back — how this process learns it has an
  // answer and the re-measure ladder can stand down.
  metricsRecorded(state, data, ctx) {
    return {
      state: {
        ...withRunId(state, data.scenarioRunId, ctx),
        measured: true,
        deadlineAt: null,
      },
      intents: [],
      nextWakeAt: null,
    };
  },
};

export function runMetricsOnWake(
  state: RunMetricsState,
  ctx: ProcessContext,
): EvolveStep<RunMetricsState, RunMetricsIntents> {
  const cleared: EvolveStep<RunMetricsState, RunMetricsIntents> = {
    state: { ...state, deadlineAt: null },
    intents: [],
    nextWakeAt: null,
  };
  const scenarioRunId = state.scenarioRunId || ctx.processKey;
  if (state.deleted || state.measured || !scenarioRunId) return cleared;

  const attempt = state.attempts + 1;
  if (attempt > RUN_METRICS_MAX_MEASUREMENTS) return cleared;

  const remeasureDelayMs = RUN_METRICS_REMEASURE_DELAYS_MS[state.attempts];
  const deadlineAt =
    remeasureDelayMs === undefined ? null : ctx.now + remeasureDelayMs;

  return {
    state: { ...state, scenarioRunId, attempts: attempt, deadlineAt },
    nextWakeAt: deadlineAt,
    intents: [
      {
        type: "computeRunMetrics",
        payload: { tenantId: ctx.tenantId, scenarioRunId, attempt },
      },
    ],
  };
}
