import { z } from "zod";

/**
 * Status values stored in ClickHouse.
 *
 * `STALLED` is one of them: it used to be derived per read and never written,
 * so the stored status and the displayed status disagreed by design. Since
 * ADR-073 step 2 the `scenarioExecution` process writes it when a run's
 * deadline fires.
 */
export const SIMULATION_RUN_STATUS = [
  "PENDING",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
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
