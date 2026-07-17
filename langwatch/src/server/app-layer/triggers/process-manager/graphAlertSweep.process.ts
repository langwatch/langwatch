import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";

import type { GraphTriggerEvaluationReason } from "../graph-trigger-evaluation.service";
import type { GraphTriggerSweepCandidate } from "../graph-trigger-heartbeat";

const logger = createLogger("langwatch:triggers:graph-alert-sweep");

/**
 * ADR-052 §4: the graph-alert absence/resolve sweep as a scheduled
 * singleton process manager.
 *
 * The candidate set derives from live Postgres (no-data-predicate
 * triggers, open TriggerSent) plus a ClickHouse recency probe — global by
 * nature, so ONE instance cluster-wide, woken every 30s by the schedule
 * (the locked ADR-034 Phase 5 cadence). Wake revision fencing replaces the
 * legacy Redis leader lock: racing workers stand down on the CAS.
 */
export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

const SWEEP_INTENT = "graph-alert-sweep" as const;
const sweepIntentSchema = z.object({ scheduledFor: z.number().int() });

/** Retention horizon for dispatched sweep rows — a new message key lands
 *  every 30s forever, so retired rows must not accumulate. */
const SWEEP_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface GraphAlertSweepState {
  /** Epoch ms of the last committed wake (observability only). */
  lastSweepAt: number | null;
}

export interface GraphAlertSweepDeps {
  /** The heartbeat candidate discovery (absence / resolve pre-filter). */
  decideSweepCandidates: (params: {
    now: Date;
  }) => Promise<GraphTriggerSweepCandidate[]>;
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

export const graphAlertSweepPM =
  (deps: GraphAlertSweepDeps): ProcessManagerApplier<TraceProcessingEvent> =>
  (pm) => {
    const now = deps.now ?? (() => Date.now());
    return pm
      .state<GraphAlertSweepState>({ lastSweepAt: null })
      .intent(SWEEP_INTENT, sweepIntentSchema, async () => {
        const startedAt = now();
        const candidates = await deps.decideSweepCandidates({
          now: new Date(startedAt),
        });
        let evaluated = 0;
        // Per-candidate failures are isolated — this is the ONLY path that
        // fires no-data alerts, so one project's transient error must not
        // silence the others. The next 30s wake is the retry.
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

        // Opportunistic retention so the 30s cadence cannot grow the
        // outbox without bound. Best-effort — never fails the sweep.
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
      })
      .onWake((_state, scheduledFor, { intents }) => ({
        state: { lastSweepAt: scheduledFor },
        // The schedule re-arms authoritatively; this value is the fallback.
        nextWakeAt: scheduledFor + GRAPH_ALERT_SWEEP_INTERVAL_MS,
        intents: [
          intents[SWEEP_INTENT]({
            key: `sweep:${scheduledFor}`,
            payload: { scheduledFor },
          }),
        ],
      }))
      .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS });
  };
