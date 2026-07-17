import { createLogger } from "@langwatch/observability";
import type { IntentHandler } from "~/server/event-sourcing/process-manager";

import type { GraphTriggerEvaluationReason } from "../graph-trigger-evaluation.service";
import {
  GRAPH_ALERT_SWEEP_INTENT_TYPES,
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
} from "./graphAlertSweepProcess.definition";

const logger = createLogger("langwatch:triggers:graph-alert-sweep");

/** Outbox retention horizon for dispatched sweep rows — the sweep inserts a
 *  new message key every 30s forever, so retired rows must not accumulate. */
const SWEEP_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface GraphAlertSweepHandlerDeps {
  /** The heartbeat candidate discovery (absence / resolve pre-filter). */
  decideSweepCandidates: (params: { now: Date }) => Promise<
    Array<{
      triggerId: string;
      projectId: string;
      reason: GraphTriggerEvaluationReason;
    }>
  >;
  /** The shared ADR-034 evaluator (owns TriggerSent idempotency). */
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
  /** Retention hook (ProcessStore.deleteDispatchedBefore). */
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

/**
 * ADR-052 §4: one sweep intent per 30s wake. Runs the same candidate
 * discovery the legacy heartbeat scheduler drove, then evaluates each
 * surviving candidate. Per-candidate failures are isolated (the sweep is
 * the ONLY path that fires no-data alerts — one project's transient error
 * must not silence the others) and do NOT retry the sweep: the next 30s
 * wake is the retry.
 */
export function createGraphAlertSweepIntentHandlers(
  deps: GraphAlertSweepHandlerDeps,
): Record<string, IntentHandler> {
  const now = deps.now ?? (() => Date.now());
  return {
    [GRAPH_ALERT_SWEEP_INTENT_TYPES.SWEEP]: async () => {
      const startedAt = now();
      const candidates = await deps.decideSweepCandidates({
        now: new Date(startedAt),
      });
      let evaluated = 0;
      for (const candidate of candidates) {
        try {
          await deps.evaluateGraphTrigger(candidate);
          evaluated++;
        } catch (error) {
          logger.error(
            {
              projectId: candidate.projectId,
              triggerId: candidate.triggerId,
              reason: candidate.reason,
              error: error instanceof Error ? error.message : String(error),
            },
            "graphAlertSweep: candidate evaluation failed; the next sweep retries it",
          );
        }
      }
      if (candidates.length > 0) {
        logger.info(
          { candidates: candidates.length, evaluated },
          "graphAlertSweep evaluated absence/resolve candidates",
        );
      }

      // Opportunistic retention: dispatched sweep rows older than the
      // horizon are dropped so the 30s cadence cannot grow the outbox
      // without bound. Best-effort — a failure here must not fail the sweep.
      try {
        await deps.deleteDispatchedBefore({
          processName: GRAPH_ALERT_SWEEP_PROCESS_NAME,
          before: startedAt - SWEEP_ROW_RETENTION_MS,
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "graphAlertSweep: outbox retention sweep failed; next sweep retries",
        );
      }
    },
  };
}
