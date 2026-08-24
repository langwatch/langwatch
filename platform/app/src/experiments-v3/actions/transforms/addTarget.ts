import { nanoid } from "nanoid";
import type { Field } from "~/optimization_studio/types/dsl";
import type { TargetConfig } from "../../types";
import {
  inferAllEvaluatorMappings,
  inferAllTargetMappings,
} from "../../utils/mappingInference";
import { type AddTargetPayload, addTargetPayloadSchema } from "../schemas";
import { type Transform, TransformError, type WorkbenchState } from "./types";

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

/**
 * A caller-supplied id has to be free. Two targets under one id make every
 * mapping filed against it ambiguous, and a scoped run could not say which
 * column it covers.
 *
 * Blank is not an id: an empty or whitespace-only string is read as "no id
 * given" and gets a generated one, so it can never reach state and make every
 * later lookup match the wrong column.
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
