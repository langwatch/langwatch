import { defineProcess } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { IntentHandler } from "../intentDispatch";

const logger = createLogger("langwatch:automations:graph-alert-sweep");

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

/** One project's graph trigger, due for a heartbeat evaluation. */
export interface GraphAlertSweepCandidate {
  readonly triggerId: string;
  readonly projectId: string;
  readonly reason: "heartbeat";
}

export interface GraphAlertSweepPorts {
  /** Every graph trigger due for a heartbeat sweep right now. Skipping a
   *  project whose real-time path is already firing is this port's decision,
   *  not the pipeline's (`specs/automations/process-manager-dispatch.feature`). */
  decideSweepCandidates(params: {
    now: Date;
  }): Promise<readonly GraphAlertSweepCandidate[]>;
  evaluateGraphTrigger(candidate: GraphAlertSweepCandidate): Promise<void>;
}

/**
 * A singleton, schedule-only process manager (ADR-098 decision 1) backstopping
 * the real-time graph-trigger subscriber. Two things need a run that does not
 * depend on activity: a "no data" alert, whose whole point is firing on the
 * ABSENCE of traces, and a lost real-time job. Every wake emits exactly one
 * intent keyed on the wake instant, so a redelivered wake collapses instead of
 * re-sweeping.
 */
export const graphAlertSweep = defineProcess(GRAPH_ALERT_SWEEP_PROCESS_NAME)
  .state(z.object({ lastSweepAt: z.number().nullable() }), () => ({
    lastSweepAt: null as number | null,
  }))
  .intents({
    evaluateGraph: {
      payload: z.object({ scheduledFor: z.number().int() }),
      messageKey: (payload) => `sweep:${payload.scheduledFor}`,
    },
  })
  .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
  .onWake((_state, intents, ctx) => ({
    state: { lastSweepAt: ctx.at },
    intents: [intents.evaluateGraph({ scheduledFor: ctx.at })],
  }))
  .build();

export type GraphAlertSweepState = ReturnType<typeof graphAlertSweep.init>;
export type EvaluateGraphIntent = Parameters<
  typeof graphAlertSweep.intents.evaluateGraph
>[0];

/** Sweeps every due candidate, isolating one candidate's failure so a single
 *  project's evaluation error never stalls the whole sweep. */
export function createEvaluateGraphHandler(
  ports: GraphAlertSweepPorts,
): IntentHandler<EvaluateGraphIntent> {
  return async (payload) => {
    const candidates = await ports.decideSweepCandidates({
      now: new Date(payload.scheduledFor),
    });
    let failures = 0;
    for (const candidate of candidates) {
      try {
        await ports.evaluateGraphTrigger(candidate);
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
    if (failures > 0) {
      logger.warn(
        { failures, candidates: candidates.length },
        "Graph-alert sweep completed with isolated candidate failures",
      );
    }
  };
}
