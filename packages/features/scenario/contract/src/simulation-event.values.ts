import { z } from "zod";

/** Values written by the Simulation event pipeline. */
export const SIMULATION_EVENT_RUN_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
] as const;
export type SimulationEventRunStatus = (typeof SIMULATION_EVENT_RUN_STATUSES)[number];

/**
 * Verdict values stored in ClickHouse.
 * Lowercase, matching the Verdict enum string values.
 */
export const SIMULATION_EVENT_VERDICTS = ["success", "failure", "inconclusive"] as const;
export type SimulationEventVerdict = (typeof SIMULATION_EVENT_VERDICTS)[number];

export const simulationEventMessageSchema = z
  .object({
    trace_id: z.string().optional(),
  })
  .passthrough();
export type SimulationEventMessage = z.infer<typeof simulationEventMessageSchema>;

export const simulationEventResultsSchema = z.object({
  verdict: z.enum(SIMULATION_EVENT_VERDICTS),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()).default([]),
  unmetCriteria: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type SimulationEventResults = z.infer<typeof simulationEventResultsSchema>;
