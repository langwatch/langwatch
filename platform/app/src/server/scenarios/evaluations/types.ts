import { z } from "zod";

/** What one evaluation job carries: enough to load everything else. */
export const scenarioEvaluationsJobPayloadSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  /** The test suite the scenario is filed in, when it has one. */
  suiteId: z.string().nullable(),
  /** The suite or run plan the run was filed under, when it was. */
  planId: z.string().nullable(),
  /** The traces the run produced, as the finished event carried them. */
  traceIds: z.array(z.string()),
  /** Starts at 1 and counts up on every requeue. */
  attempt: z.number().int().min(1),
  occurredAt: z.number(),
});
export type ScenarioEvaluationsJobPayload = z.infer<
  typeof scenarioEvaluationsJobPayloadSchema
>;
