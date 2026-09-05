/**
 * The rules the suite editor and the run dialog apply to an evaluator
 * attachment: how one is built when an evaluator is picked, whether it can
 * gate a scenario, and which of its inputs still read nothing.
 *
 * Everything here is pure, so the chips, the editor and the run gate read
 * one answer for one attachment.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { nanoid } from "nanoid";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import {
  attachmentMissingInputs,
  attachmentOpensOnAttach,
  type EvaluatorAttachment,
  type EvaluatorInputSpec,
  inferScenarioMappings,
  isExpectedLikeInput,
  type ScenarioMappingContext,
} from "~/server/scenarios/evaluator-attachments";
import { evaluatorInputSpecsOf } from "~/server/suites/suite-evaluators";

/** As much of a saved evaluator as the attachment rules read. */
export type AttachableEvaluator = Pick<
  EvaluatorWithFields,
  "id" | "name" | "type" | "config" | "fields" | "outputFields"
>;

/** The type of a saved evaluator, as the editor drawer is opened on it. */
export function evaluatorTypeOf(
  evaluator: Pick<AttachableEvaluator, "config">,
): string | undefined {
  return (evaluator.config as { evaluatorType?: string } | null)?.evaluatorType;
}

/**
 * Whether the evaluator can be required: it produces a pass or fail verdict.
 * A score only evaluator reports and never gates.
 */
export function evaluatorCanRequire(
  evaluator: Pick<AttachableEvaluator, "outputFields">,
): boolean {
  return evaluator.outputFields.some((field) => field.identifier === "passed");
}

/**
 * Whether the evaluator reads only the conversation and the trace, which is
 * what a run plan can offer. An input that expects a golden value needs a
 * scenario field, and only a test suite declares those.
 */
export function evaluatorFitsPlanLevel(
  evaluator: Pick<AttachableEvaluator, "fields">,
): boolean {
  return !evaluator.fields.some((field) =>
    isExpectedLikeInput(field.identifier),
  );
}

/**
 * The attachment an evaluator gets when it is picked: a fresh id, the
 * mappings the rules can infer, and required when the evaluator can gate.
 */
export function newAttachment({
  evaluator,
  ctx,
  isPlanLevel,
}: {
  evaluator: AttachableEvaluator;
  ctx: ScenarioMappingContext;
  isPlanLevel?: boolean;
}): EvaluatorAttachment {
  return {
    id: nanoid(),
    evaluatorId: evaluator.id,
    required: evaluatorCanRequire(evaluator),
    mappings: inferScenarioMappings({
      inputs: evaluatorInputSpecsOf(evaluator),
      ctx,
      isPlanLevel,
    }),
  };
}

/** The required inputs of the attachment that read nothing yet. */
export function missingInputsOf({
  attachment,
  evaluator,
}: {
  attachment: Pick<EvaluatorAttachment, "mappings">;
  evaluator: Pick<AttachableEvaluator, "fields"> | undefined;
}): EvaluatorInputSpec[] {
  if (!evaluator) return [];
  return attachmentMissingInputs({
    attachment,
    inputs: evaluatorInputSpecsOf(evaluator),
  });
}

/** Whether picking this evaluator opens its editor right away. */
export function opensOnAttach({
  attachment,
  evaluator,
}: {
  attachment: Pick<EvaluatorAttachment, "mappings">;
  evaluator: Pick<AttachableEvaluator, "fields">;
}): boolean {
  return attachmentOpensOnAttach({
    attachment,
    inputs: evaluatorInputSpecsOf(evaluator),
  });
}
