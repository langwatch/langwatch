import { z } from "zod";
import { evaluatorAttachmentsSchema } from "../evaluator-attachments";
import { runEvaluatorDefinitionSchema } from "../scenario-run-evaluators";
import { scenarioFieldValuesSchema } from "../suite-fields";

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
  /**
   * The scenario's field values as they stood when the run was queued, so an
   * edit to the scenario while the run executes, or between two attempts,
   * never changes what it is graded against. A job queued before they were
   * carried reads the scenario when it runs.
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
