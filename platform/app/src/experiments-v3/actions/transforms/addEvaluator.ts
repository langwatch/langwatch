import { nanoid } from "nanoid";
import type { Field } from "~/optimization_studio/types/dsl";
import type { EvaluatorConfig } from "../../types";
import { inferAllEvaluatorMappings } from "../../utils/mappingInference";
import {
  type AddEvaluatorPayload,
  addEvaluatorPayloadSchema,
} from "../schemas";
import { type Transform, TransformError, type WorkbenchState } from "./types";

export const newEvaluatorId = () => `evaluator_${nanoid(8)}`;

/**
 * Append an evaluator and wire it up.
 *
 * Evaluators are global: one evaluator grades every target, so auto-mapping
 * runs across datasets x targets. Mappings on the payload always win —
 * inference only fills gaps.
 */
export const attachEvaluator = ({
  state,
  evaluator,
}: {
  state: WorkbenchState;
  evaluator: EvaluatorConfig;
}): WorkbenchState => ({
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
});

/**
 * A caller-supplied id has to be free. Two evaluators under one id make the
 * mappings and the scores filed against it ambiguous, and the table could not
 * say which one a score column belongs to.
 *
 * Blank is not an id: an empty or whitespace-only string is read as "no id
 * given" and gets a generated one, so it can never reach state and make every
 * later lookup match the wrong evaluator.
 */
export const addEvaluator: Transform<
  AddEvaluatorPayload,
  { evaluatorId: string }
> = ({ state, payload }) => {
  const parsed = addEvaluatorPayloadSchema.parse(payload);
  const requestedId = parsed.id?.trim();

  if (requestedId && state.evaluators.some((e) => e.id === requestedId)) {
    throw new TransformError({
      code: "evaluator_already_exists",
      message: `Evaluator ${requestedId} is already in the workbench`,
      meta: { evaluatorId: requestedId },
    });
  }

  const evaluator: EvaluatorConfig = {
    ...parsed,
    id: requestedId || newEvaluatorId(),
    evaluatorType: parsed.evaluatorType as EvaluatorConfig["evaluatorType"],
    inputs: parsed.inputs as Field[],
  };

  return {
    state: attachEvaluator({ state, evaluator }),
    result: { evaluatorId: evaluator.id },
  };
};
