import type { EvaluatorConfig, FieldMapping, TargetConfig } from "../../types";
import {
  type DuplicateTargetPayload,
  duplicateTargetPayloadSchema,
} from "../schemas";
import { attachTarget, newTargetId } from "./add-target";
import { requireTarget } from "./helpers";
import type { Transform } from "./types";

/**
 * A mapping that reads the source target's output must read the copy's output
 * instead — the duplicate is a new column and grades itself, not its original.
 * Every other mapping (dataset sources, literal values, other targets) is
 * copied unchanged.
 */
const repointToCopy = ({
  mapping,
  sourceTargetId,
  copyTargetId,
}: {
  mapping: FieldMapping;
  sourceTargetId: string;
  copyTargetId: string;
}): FieldMapping =>
  mapping.type === "source" &&
  mapping.source === "target" &&
  mapping.sourceId === sourceTargetId
    ? { ...mapping, sourceId: copyTargetId }
    : { ...mapping };

const copyFieldMappings = ({
  mappings,
  sourceTargetId,
  copyTargetId,
}: {
  mappings: Record<string, FieldMapping>;
  sourceTargetId: string;
  copyTargetId: string;
}): Record<string, FieldMapping> =>
  Object.fromEntries(
    Object.entries(mappings).map(([field, mapping]) => [
      field,
      repointToCopy({ mapping, sourceTargetId, copyTargetId }),
    ]),
  );

/**
 * Duplicate a target, keeping its wiring.
 *
 * The copy carries the source's own per-dataset mappings AND a copy of every
 * evaluator's `mappings[datasetId][sourceTargetId]` bucket, so the duplicate's
 * evaluators grade the same fields the source's do. Without the second half the
 * copy would rely on re-inference, which silently drops any mapping the user
 * had picked by hand.
 *
 * Gaps left by the copy (a dataset the source was never mapped against, an
 * evaluator input the source had unmapped) are filled by the same auto-mapping
 * `addTarget` runs, so a duplicate is never wired worse than a fresh add.
 */
export const duplicateTarget: Transform<
  DuplicateTargetPayload,
  { targetId: string; name?: string }
> = ({ state, payload }) => {
  const { targetId, name } = duplicateTargetPayloadSchema.parse(payload);
  const source = requireTarget({ state, targetId });

  const copyTargetId = newTargetId();

  const mappings: TargetConfig["mappings"] = {};
  for (const [datasetId, fieldMappings] of Object.entries(source.mappings)) {
    mappings[datasetId] = copyFieldMappings({
      mappings: fieldMappings,
      sourceTargetId: targetId,
      copyTargetId,
    });
  }

  // Only evaluator targets hold a name in workbench state. Prompt, agent and
  // workflow targets take their displayed name from the entity they reference.
  const renameable = source.type === "evaluator";
  const localEvaluatorConfig =
    name && renameable
      ? { ...source.localEvaluatorConfig, name }
      : source.localEvaluatorConfig;

  const copy: TargetConfig = {
    ...source,
    id: copyTargetId,
    mappings,
    localEvaluatorConfig,
  };

  const evaluators: EvaluatorConfig[] = state.evaluators.map((evaluator) => {
    const nextMappings: EvaluatorConfig["mappings"] = {};
    let copied = false;
    for (const [datasetId, byTarget] of Object.entries(evaluator.mappings)) {
      const sourceMappings = byTarget[targetId];
      if (!sourceMappings) {
        nextMappings[datasetId] = byTarget;
        continue;
      }
      copied = true;
      nextMappings[datasetId] = {
        ...byTarget,
        [copyTargetId]: copyFieldMappings({
          mappings: sourceMappings,
          sourceTargetId: targetId,
          copyTargetId,
        }),
      };
    }
    return copied ? { ...evaluator, mappings: nextMappings } : evaluator;
  });

  return {
    state: attachTarget({ state: { ...state, evaluators }, target: copy }),
    result: {
      targetId: copyTargetId,
      name: renameable ? localEvaluatorConfig?.name : undefined,
    },
  };
};
