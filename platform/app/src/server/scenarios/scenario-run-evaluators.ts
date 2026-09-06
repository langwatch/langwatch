/**
 * The evaluators one scenario run is graded with, and whether it still owes
 * their results.
 *
 * The set is resolved once, when the run is queued, and travels on the run's
 * own events: queued carries it, finished carries it forward, the evaluation
 * job payload carries it to the worker. It holds the attachments, the
 * scenario's field values the mappings read and the definition of every
 * attached evaluator. Nothing downstream reads the suite, the run plan, the
 * scenario's fields or the saved evaluators again, so editing any of them
 * while a batch is executing changes the next runs and never the ones already
 * queued, and a retry of the evaluation job grades exactly what the first
 * attempt would have.
 *
 * A finished run that owes results is stored with the status
 * PENDING_EVALUATION, the way a scheduled run is stored QUEUED, until the
 * evaluated event records them and the gate writes the terminal status. A
 * grading job that is lost outright is recorded as errored evaluators by the
 * run execution process manager once its deadline passes, so a required
 * evaluator that never ran fails the run instead of leaving it pending.
 *
 * @see specs/scenarios/scenario-evaluation-pending.feature
 */

import { z } from "zod";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import { evaluatorAttachmentsSchema } from "./evaluator-attachments";
import { ScenarioRunStatus } from "./scenario-event.enums";
import { scenarioFieldValuesSchema } from "./suite-fields";

/** One input a saved evaluator declares. */
export const runEvaluatorFieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  optional: z.boolean().optional(),
});

/**
 * A saved evaluator as the worker runs it: what the runner dispatches on and
 * the settings and inputs it runs with. Saved evaluators carry no revision,
 * so the definition itself is recorded.
 */
export const runEvaluatorDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "evaluator" for a built-in, "workflow" or "code". */
  type: z.string(),
  /** The built-in evaluator type the saved evaluator names, when it does. */
  evaluatorType: z.string().nullable(),
  workflowId: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  fields: z.array(runEvaluatorFieldSchema),
});
export type RunEvaluatorDefinition = z.infer<
  typeof runEvaluatorDefinitionSchema
>;

/**
 * The evaluators a run was queued with: the attachments and where they came
 * from, the scenario's field values the mappings read and the definition of
 * every attached evaluator, all as they stood at that moment.
 */
export const runEvaluatorsSchema = z.object({
  /** The scenario's test suite, when it is filed in one. */
  suiteId: z.string().nullable(),
  /** The run plan the run was filed under, when it was. */
  planId: z.string().nullable(),
  attachments: evaluatorAttachmentsSchema,
  /**
   * The scenario's field values. Absent on a run queued before they were
   * carried, which reads the scenario when it is graded.
   */
  fieldValues: scenarioFieldValuesSchema.optional(),
  /**
   * The attached evaluators, one per evaluator the project held when the run
   * was queued. Absent on a run queued before they were carried, which reads
   * the saved evaluators when it is graded.
   */
  definitions: z.array(runEvaluatorDefinitionSchema).optional(),
});
export type RunEvaluators = z.infer<typeof runEvaluatorsSchema>;

/** The definition the worker keeps of a saved evaluator. */
export function runEvaluatorDefinitionOf(
  evaluator: Pick<
    EvaluatorWithFields,
    "id" | "name" | "type" | "config" | "workflowId" | "fields"
  >,
): RunEvaluatorDefinition {
  const config = evaluator.config as {
    evaluatorType?: string;
    settings?: Record<string, unknown>;
  } | null;
  return {
    id: evaluator.id,
    name: evaluator.name,
    type: evaluator.type,
    evaluatorType: config?.evaluatorType ?? null,
    workflowId: evaluator.workflowId,
    settings: config?.settings ?? {},
    fields: evaluator.fields.map((field) => ({
      identifier: field.identifier,
      type: field.type,
      ...(field.optional !== undefined && { optional: field.optional }),
    })),
  };
}

/** The statuses a finished run can hold with no conversation to grade. */
export const UNGRADED_RUN_STATUSES: ReadonlySet<string> = new Set([
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

/**
 * Whether a run that has just finished still owes evaluator results.
 *
 * A run whose own results carry evaluations was graded by the code that ran
 * it. A run that errored or was cancelled has nothing to grade. Everything
 * else owes one result per attachment it was queued with.
 *
 * The fold, the subscriber that queues the job and the process manager that
 * watches for a lost job all read this, so the status a run is stored with,
 * the work queued for it and the deadline armed for it cannot disagree.
 */
export function runAwaitsEvaluations({
  status,
  hasOwnEvaluations,
  attachmentCount,
}: {
  status: string | undefined;
  hasOwnEvaluations: boolean;
  attachmentCount: number;
}): boolean {
  if (hasOwnEvaluations) return false;
  if (status && UNGRADED_RUN_STATUSES.has(status)) return false;
  return attachmentCount > 0;
}
