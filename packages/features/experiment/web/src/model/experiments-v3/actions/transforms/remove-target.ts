import type { FieldMapping } from "../../types";
import { type RemoveTargetPayload, removeTargetPayloadSchema } from "../schemas";
import { requireTarget } from "./helpers";
import type { Transform } from "./types";

/**
 * A removed target must also leave every comparison that names it as a variant.
 * A phantom variant renders nothing in the comparison form, so there is no way
 * to drop it from the UI, and the orchestrator then resolves zero cells for
 * that comparison forever with no error anywhere.
 */
const dropVariant = <T extends { comparison?: { variants: string[] } }>({
  carrier,
  targetId,
}: {
  carrier: T;
  targetId: string;
}): T =>
  carrier.comparison
    ? {
        ...carrier,
        comparison: {
          ...carrier.comparison,
          variants: carrier.comparison.variants.filter((v) => v !== targetId),
        },
      }
    : carrier;

/**
 * Remove a target and every reference to it: its own column, its bucket in each
 * evaluator's mappings, any other target's mapping that read its output, and
 * its slot in any comparison.
 *
 * An id the workbench does not hold is refused rather than reported as a
 * removal, so a caller that misnamed a column learns it instead of reading
 * "the column is gone" and moving on.
 */
export const removeTarget: Transform<RemoveTargetPayload, { targetId: string }> = ({
  state,
  payload,
}) => {
  const { targetId } = removeTargetPayloadSchema.parse(payload);
  requireTarget({ state, targetId });

  const evaluators = state.evaluators.map((evaluator) => {
    const mappings: typeof evaluator.mappings = {};
    for (const [datasetId, targetMappings] of Object.entries(evaluator.mappings)) {
      const remaining = { ...targetMappings };
      delete remaining[targetId];
      mappings[datasetId] = remaining;
    }
    return dropVariant({ carrier: { ...evaluator, mappings }, targetId });
  });

  const targets = state.targets
    .filter((target) => target.id !== targetId)
    .map((target) => {
      const mappings: typeof target.mappings = {};
      for (const [datasetId, fieldMappings] of Object.entries(target.mappings)) {
        const remaining: Record<string, FieldMapping> = {};
        for (const [field, mapping] of Object.entries(fieldMappings)) {
          const readsRemovedTarget =
            mapping.type === "source" &&
            mapping.source === "target" &&
            mapping.sourceId === targetId;
          if (!readsRemovedTarget) {
            remaining[field] = mapping;
          }
        }
        mappings[datasetId] = remaining;
      }
      return dropVariant({ carrier: { ...target, mappings }, targetId });
    });

  return {
    state: { ...state, targets, evaluators },
    result: { targetId },
  };
};
