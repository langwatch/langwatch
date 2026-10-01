import { z } from "zod";

import { scenarioCriterionResultSchema } from "./scenario-criterion-result.ts";
import { scenarioEvaluationResultSchema } from "./scenario-evaluation-result.ts";

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
  /** Criteria the judge could not decide; each is also in `unmetCriteria`. */
  inconclusiveCriteria: z.array(z.string()).optional(),
  /** Each criterion with its own status and reasoning; absent on older SDKs. */
  criteria: z.array(scenarioCriterionResultSchema).optional(),
  error: z.string().optional(),
  /** Code-triggered runs send their evaluations with the finished event. */
  evaluations: z.array(scenarioEvaluationResultSchema).optional(),
});
export type SimulationEventResults = z.infer<typeof simulationEventResultsSchema>;
