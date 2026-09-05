import { z } from "zod";
import { evaluatorAttachmentsSchema } from "../evaluator-attachments";

/** What one evaluation job carries: enough to load everything else. */
export const scenarioEvaluationsJobPayloadSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  /** The test suite the scenario is filed in, when it has one. */
  suiteId: z.string().nullable(),
  /** The suite or run plan the run was filed under, when it was. */
  planId: z.string().nullable(),
  /**
   * The evaluators the run is graded with, as they stood when it was queued.
   * Carried on the payload so every retry grades the same set, and so an edit
   * to the suite or the plan while the run executes never changes what an
   * existing run is graded against.
   *
   * Optional for a job queued before this was carried; such a job reads the
   * suite and the plan when it runs.
   */
  attachments: evaluatorAttachmentsSchema.optional(),
  /** The traces the run produced, as the finished event carried them. */
  traceIds: z.array(z.string()),
  /** Starts at 1 and counts up on every requeue. */
  attempt: z.number().int().min(1),
  occurredAt: z.number(),
});
export type ScenarioEvaluationsJobPayload = z.infer<
  typeof scenarioEvaluationsJobPayloadSchema
>;
