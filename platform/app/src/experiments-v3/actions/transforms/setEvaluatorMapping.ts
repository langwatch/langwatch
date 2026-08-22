import {
  type SetEvaluatorMappingPayload,
  setEvaluatorMappingPayloadSchema,
} from "../schemas";
import { requireEvaluator } from "./helpers";
import type { Transform } from "./types";

/**
 * Point one evaluator input field at a source, for one dataset and one target.
 *
 * Evaluator mappings are three levels deep because every evaluator applies to
 * every target: the same evaluator grades target A's `output` and target B's,
 * and those two live in different columns.
 */
export const setEvaluatorMapping: Transform<
  SetEvaluatorMappingPayload,
  { evaluatorId: string }
> = ({ state, payload }) => {
  const { evaluatorId, datasetId, targetId, inputField, mapping } =
    setEvaluatorMappingPayloadSchema.parse(payload);
  requireEvaluator({ state, evaluatorId });

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
                  ...(evaluator.mappings[datasetId] ?? {}),
                  [targetId]: {
                    ...(evaluator.mappings[datasetId]?.[targetId] ?? {}),
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
