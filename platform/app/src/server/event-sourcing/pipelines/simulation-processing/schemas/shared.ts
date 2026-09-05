import { z } from "zod";
import { scenarioEvaluationResultSchema } from "~/server/scenarios/schemas/event-schemas";

/**
 * Status values stored in ClickHouse.
 * STALLED is never written: stalled runs finish ERROR via the process-manager
 * stall watchdog, and nothing derives STALLED at read time anymore.
 * PENDING_EVALUATION is written by the fold when a run finishes owing its
 * evaluator results, and replaced by the gated terminal status when they are
 * recorded.
 */
export const SIMULATION_RUN_STATUS = [
  "PENDING",
  "IN_PROGRESS",
  "PENDING_EVALUATION",
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
] as const;
export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUS)[number];

/**
 * Verdict values stored in ClickHouse.
 * Lowercase, matching the Verdict enum string values.
 */
export const SIMULATION_VERDICT = [
  "success",
  "failure",
  "inconclusive",
] as const;
export type SimulationVerdict = (typeof SIMULATION_VERDICT)[number];

export const simulationMessageSchema = z
  .object({
    trace_id: z.string().optional(),
  })
  .passthrough();
export type SimulationMessage = z.infer<typeof simulationMessageSchema>;

export const simulationResultsSchema = z.object({
  verdict: z.enum(SIMULATION_VERDICT),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()).default([]),
  unmetCriteria: z.array(z.string()).default([]),
  error: z.string().optional(),
  /**
   * The evaluator results a scenario run from code sends with its finished
   * event. The platform stores them as sent and runs no evaluator of its own
   * on that run.
   */
  evaluations: z.array(scenarioEvaluationResultSchema).optional(),
});
export type SimulationResults = z.infer<typeof simulationResultsSchema>;
