/**
 * Evaluators a run is graded with, resolved at queue time and immutable.
 * Owes results until evaluation job completes and gate writes terminal status.
 */

import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { z } from "zod";

import { evaluatorAttachmentsSchema } from "./evaluator-attachments.ts";
import { scenarioFieldValuesSchema } from "./suite-fields.ts";

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
export type RunEvaluatorDefinition = z.infer<typeof runEvaluatorDefinitionSchema>;

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
  evaluator: Pick<EvaluatorWithFields, "id" | "name" | "type" | "config" | "workflowId" | "fields">,
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
