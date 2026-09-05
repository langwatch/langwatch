import { nanoid } from "nanoid";
import type { Field } from "@langwatch/workflow-contract";
import type { TargetConfig } from "../../types";
import { inferAllEvaluatorMappings, inferAllTargetMappings } from "../../mapping-inference";
import { type AddTargetPayload, addTargetPayloadSchema } from "../schemas";
import { type Transform, TransformError, type WorkbenchState } from "./types";

export const newTargetId = () => `target-${nanoid(8)}`;

/**
 * Append a target and wire it up.
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

/**
 * A caller-supplied id has to be free. Two targets under one id make every mapping
 * filed against it ambiguous, and a scoped run could not say which column it covers.
 */
export const addTarget: Transform<AddTargetPayload, { targetId: string }> = ({
  state,
  payload,
}) => {
  const parsed = addTargetPayloadSchema.parse(payload);
  const requestedId = parsed.id?.trim();

  if (requestedId && state.targets.some((t) => t.id === requestedId)) {
    throw new TransformError({
      code: "target_already_exists",
      message: `Target ${requestedId} is already in the workbench`,
      meta: { targetId: requestedId },
    });
  }

  const target: TargetConfig = {
    ...parsed,
    id: requestedId || newTargetId(),
    inputs: parsed.inputs as Field[],
    outputs: parsed.outputs as Field[],
  };

  return {
    state: attachTarget({ state, target }),
    result: { targetId: target.id },
  };
};
