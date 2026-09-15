import { z } from "zod";
import { evaluatorAttachmentsSchema } from "../evaluator-attachments.ts";
import { runEvaluatorDefinitionSchema } from "../scenario-run-evaluators.ts";
import { scenarioFieldValuesSchema } from "../suite-fields.ts";

/** What one evaluation job carries: enough to load everything else. */
export const scenarioEvaluationsJobPayloadSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  /** The test suite the scenario is filed in, when it has one. */
  suiteId: z.string().nullable(),
  /** The suite or run plan the run was filed under, when it was. */
  planId: z.string().nullable(),
  /** Evaluators as they stood at queue time, so retries grade consistently
   * despite suite or plan edits while the run executes.
   */
  attachments: evaluatorAttachmentsSchema.optional(),
  /**
   * The scenario's field values as they stood when queued, so an edit while
   * the run executes, or between attempts, never changes what it is graded
   * against. A job queued before they were carried reads the scenario live.
   */
  fieldValues: scenarioFieldValuesSchema.optional(),
  /**
   * The attached evaluators as they were saved when the run was queued, for
   * the same reason. A job queued before they were carried reads the saved
   * evaluators when it runs.
   */
  definitions: z.array(runEvaluatorDefinitionSchema).optional(),
  /** The traces the run produced, as the finished event carried them. */
  traceIds: z.array(z.string()),
  /** Starts at 1 and counts up on every requeue. */
  attempt: z.number().int().min(1),
  occurredAt: z.number(),
});
export type ScenarioEvaluationsJobPayload = z.infer<
  typeof scenarioEvaluationsJobPayloadSchema
>;
