import { nanoid } from "nanoid";
import type { Field } from "~/optimization_studio/types/dsl";
import type { EvaluatorConfig } from "../../types";
import { inferAllEvaluatorMappings } from "../../utils/mappingInference";
import {
  type AddEvaluatorPayload,
  addEvaluatorPayloadSchema,
} from "../schemas";
import type { Transform, WorkbenchState } from "./types";

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

export const addEvaluator: Transform<
  AddEvaluatorPayload,
  { evaluatorId: string }
> = ({ state, payload }) => {
  const parsed = addEvaluatorPayloadSchema.parse(payload);

  const evaluator: EvaluatorConfig = {
    ...parsed,
    id: parsed.id ?? newEvaluatorId(),
    evaluatorType: parsed.evaluatorType as EvaluatorConfig["evaluatorType"],
    inputs: parsed.inputs as Field[],
  };

  return {
    state: attachEvaluator({ state, evaluator }),
    result: { evaluatorId: evaluator.id },
  };
};
