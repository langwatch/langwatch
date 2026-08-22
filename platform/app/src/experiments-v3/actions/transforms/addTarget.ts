import { nanoid } from "nanoid";
import type { Field } from "~/optimization_studio/types/dsl";
import type { TargetConfig } from "../../types";
import {
  inferAllEvaluatorMappings,
  inferAllTargetMappings,
} from "../../utils/mappingInference";
import { type AddTargetPayload, addTargetPayloadSchema } from "../schemas";
import type { Transform, WorkbenchState } from "./types";

export const newTargetId = () => `target-${nanoid(8)}`;

/**
 * Append a target and wire it up.
 *
 * Auto-mapping runs once, on add: the target's inputs are matched against every
 * dataset's columns, and every existing evaluator gets mappings for the new
 * target. Mappings already on the target always win — inference only fills
 * gaps. Takes a built target so callers holding one from state (a duplicate)
 * do not have to round-trip it through the payload schema.
 */
export const attachTarget = ({
  state,
  target,
}: {
  state: WorkbenchState;
  target: TargetConfig;
}): WorkbenchState => {
  const targetWithMappings: TargetConfig = {
    ...target,
    mappings: {
      ...target.mappings,
      ...inferAllTargetMappings(target, state.datasets),
    },
  };

  const evaluators = state.evaluators.map((evaluator) => {
    const inferred = inferAllEvaluatorMappings(
      evaluator,
      state.datasets,
      // Only the new target: the others keep the mappings they already have.
      [targetWithMappings],
    );
    const mappings = { ...evaluator.mappings };
    for (const [datasetId, targetMappings] of Object.entries(inferred)) {
      mappings[datasetId] = { ...mappings[datasetId], ...targetMappings };
    }
    return { ...evaluator, mappings };
  });

  return {
    ...state,
    targets: [...state.targets, targetWithMappings],
    evaluators,
  };
};

export const addTarget: Transform<AddTargetPayload, { targetId: string }> = ({
  state,
  payload,
}) => {
  const parsed = addTargetPayloadSchema.parse(payload);

  const target: TargetConfig = {
    ...parsed,
    id: parsed.id ?? newTargetId(),
    inputs: parsed.inputs as Field[],
    outputs: parsed.outputs as Field[],
  };

  return {
    state: attachTarget({ state, target }),
    result: { targetId: target.id },
  };
};
