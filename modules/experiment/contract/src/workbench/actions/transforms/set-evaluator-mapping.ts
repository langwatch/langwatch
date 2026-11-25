import { type SetEvaluatorMappingPayload, setEvaluatorMappingPayloadSchema } from "../schemas.ts";
import { getDataset, getEvaluator, getTarget } from "./helpers.ts";
import type { Transform } from "./types.ts";

/**
 * Point one evaluator input field at a source, for one dataset and one target.
 */
export const setEvaluatorMapping: Transform<
  SetEvaluatorMappingPayload,
  { evaluatorId: string }
> = ({ state, payload }) => {
  const { evaluatorId, datasetId, targetId, inputField, mapping } =
    setEvaluatorMappingPayloadSchema.parse(payload);
  getEvaluator({ state, evaluatorId });
  getDataset({ state, datasetId });
  getTarget({ state, targetId });

  return {
    state: {
      ...state,
      evaluators: state.evaluators.map((evaluator) =>
        evaluator.id === evaluatorId
          ? {
              ...evaluator,
              mappings: {
                ...evaluator.mappings,
                [datasetId]: {
                  ...evaluator.mappings[datasetId],
                  [targetId]: {
                    ...evaluator.mappings[datasetId]?.[targetId],
                    [inputField]: mapping,
                  },
                },
              },
            }
          : evaluator,
      ),
    },
    result: { evaluatorId },
  };
};
