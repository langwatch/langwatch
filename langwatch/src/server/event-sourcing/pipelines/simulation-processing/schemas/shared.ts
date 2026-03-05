import { z } from "zod";

/**
 * Status values stored in ClickHouse.
 * STALLED is computed at read time, not stored.
 */
export const SIMULATION_RUN_STATUS = [
  "PENDING",
  "IN_PROGRESS",
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
export const SIMULATION_VERDICT = ["success", "failure", "inconclusive"] as const;
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
});
export type SimulationResults = z.infer<typeof simulationResultsSchema>;
