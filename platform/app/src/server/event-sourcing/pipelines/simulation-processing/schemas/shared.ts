import { z } from "zod";

/**
 * Status values stored in ClickHouse. The fold writes the
 * `ScenarioRunStatus` members (FAILED, never FAILURE — #6834); "FAILURE"
 * stays listed only because historical rows and pre-fix events still carry
 * it, and every reader tolerates it.
 *
 * STALLED is likewise never written anew: stalled runs finish ERROR via the
 * process-manager stall watchdog, and nothing derives STALLED at read time
 * anymore. It stays listed for historical rows, which readers still tolerate.
 */
export const SIMULATION_RUN_STATUS = [
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILED",
  /** Legacy alias of FAILED — historical rows only, never written anew. */
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
});
export type SimulationResults = z.infer<typeof simulationResultsSchema>;
