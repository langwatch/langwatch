import { z } from "zod";

/**
 * Simulation run status values.
 * Mirrors ScenarioRunStatus from the scenario-events API but avoids
 * importing from the [[...route]] directory which breaks Node module resolution.
 */
export const SIMULATION_RUN_STATUS = [
  "SUCCESS",
  "ERROR",
  "CANCELLED",
  "IN_PROGRESS",
  "PENDING",
  "FAILED",
] as const;

export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUS)[number];

/**
 * Verdict values for simulation results.
 */
export const SIMULATION_VERDICT = [
  "success",
  "failure",
  "inconclusive",
] as const;

export type SimulationVerdict = (typeof SIMULATION_VERDICT)[number];

/**
 * Schema for simulation results.
 * Mirrors scenarioResultsSchema from the scenario-events API.
 */
export const simulationResultsSchema = z.object({
  verdict: z.enum(SIMULATION_VERDICT),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  error: z.string().optional(),
});

export type SimulationResults = z.infer<typeof simulationResultsSchema>;
