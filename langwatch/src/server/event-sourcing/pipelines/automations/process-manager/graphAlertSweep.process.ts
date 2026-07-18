import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { AutomationEvent } from "~/server/event-sourcing/pipelines/automations/schemas/events";

import type { GraphTriggerEvaluationReason } from "../../../../app-layer/automations/graph-trigger-evaluation.service";
import type { GraphTriggerSweepCandidate } from "../../../../app-layer/automations/graph-trigger-heartbeat";

const logger = createLogger("langwatch:triggers:graph-alert-sweep");

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;
const SWEEP_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export const sweepSchema = z.object({ scheduledFor: z.number().int() });

export interface GraphAlertSweepState {
  lastSweepAt: number | null;
}

export interface GraphAlertSweepDeps {
  decideSweepCandidates: (params: {
    now: Date;
  }) => Promise<GraphTriggerSweepCandidate[]>;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type SweepIntents = {
  evaluateGraph: IntentSpec<typeof sweepSchema>;
};

const sweep: WakeHandler<GraphAlertSweepState, SweepIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [
    ctx.intents.evaluateGraph(`sweep:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});

function runSweep(deps: GraphAlertSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const candidates = await deps.decideSweepCandidates({
      now: new Date(startedAt),
    });
    let failures = 0;
    for (const candidate of candidates) {
      try {
        await deps.evaluateGraphTrigger(candidate);
      } catch (error) {
        failures++;
        logger.error(
          {
            projectId: candidate.projectId,
            triggerId: candidate.triggerId,
            reason: candidate.reason,
            error: error instanceof Error ? error.message : String(error),
          },
          "Graph-alert sweep candidate failed; the next sweep retries it",
        );
      }
    }
    try {
      await deps.deleteDispatchedBefore({
        processName: GRAPH_ALERT_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Graph-alert sweep outbox retention failed",
      );
    }
    if (failures > 0) {
      logger.warn(
        { failures, candidates: candidates.length },
        "Graph-alert sweep completed with isolated candidate failures",
      );
    }
  };
}

export const graphAlertSweepPM = (
  deps: GraphAlertSweepDeps,
): ProcessManagerApplier<AutomationEvent> =>
  (pm) =>
    pm
      .state<GraphAlertSweepState>({ lastSweepAt: null })
      .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
      .onWake(sweep)
      .intent("evaluateGraph", sweepSchema, runSweep(deps));
