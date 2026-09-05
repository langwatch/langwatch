import { nanoid } from "nanoid";
import type { Field } from "@langwatch/workflow-contract";
import {
  COMPARISON_COLUMN_REFUSAL,
  type EvaluatorConfig,
  isComparisonEvaluatorType,
} from "../../types";
import { inferAllEvaluatorMappings } from "../../mapping-inference";
import { type AddEvaluatorPayload, addEvaluatorPayloadSchema } from "../schemas";
import { type Transform, TransformError, type WorkbenchState } from "./types";

export const newEvaluatorId = () => `evaluator_${nanoid(8)}`;

/**
 * Refuses an evaluator that carries a `comparison` config it cannot own.
 */
export const assertComparisonColumnAllowed = (evaluator: {
  id?: string;
  evaluatorType?: string;
  comparison?: unknown;
}): void => {
  if (!evaluator.comparison) return;
  if (isComparisonEvaluatorType(evaluator.evaluatorType)) return;

  throw new TransformError({
    code: "evaluator_comparison_type_invalid",
    message: COMPARISON_COLUMN_REFUSAL,
    meta: {
      ...(evaluator.id ? { evaluatorId: evaluator.id } : {}),
      evaluatorType: evaluator.evaluatorType,
    },
  });
};

/**
 * Append an evaluator and wire it up.
 */
export const attachEvaluator = ({
  state,
  evaluator,
}: {
  state: WorkbenchState;
  evaluator: EvaluatorConfig;
}): WorkbenchState => {
  assertComparisonColumnAllowed(evaluator);

  return {
    ...state,
    evaluators: [
      ...state.evaluators,
      {
        ...evaluator,
        mappings: {
          ...evaluator.mappings,
          ...inferAllEvaluatorMappings(evaluator, state.datasets, state.targets),
        },
      },
    ],
  };
};

/**
 * A caller-supplied id has to be free. Two evaluators under one id make the mappings
 * and the scores filed against it ambiguous, and the table could not say which one a
 * score column belongs to.
 */
export const addEvaluator: Transform<AddEvaluatorPayload, { evaluatorId: string }> = ({
  state,
  payload,
}) => {
  const parsed = addEvaluatorPayloadSchema.parse(payload);
  const requestedId = parsed.id?.trim();

  if (requestedId && state.evaluators.some((e) => e.id === requestedId)) {
    throw new TransformError({
      code: "evaluator_already_exists",
      message: `Evaluator ${requestedId} is already in the workbench`,
      meta: { evaluatorId: requestedId },
    });
  }

  const { name, ...rest } = parsed;
  const evaluator: EvaluatorConfig = {
    ...rest,
    id: requestedId || newEvaluatorId(),
    evaluatorType: parsed.evaluatorType as EvaluatorConfig["evaluatorType"],
    inputs: parsed.inputs as Field[],
    localEvaluatorConfig: { ...parsed.localEvaluatorConfig, name },
  };

  return {
    state: attachEvaluator({ state, evaluator }),
    result: { evaluatorId: evaluator.id },
  };
};
