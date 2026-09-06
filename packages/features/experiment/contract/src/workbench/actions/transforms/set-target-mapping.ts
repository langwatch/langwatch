import { type SetMappingPayload, setMappingPayloadSchema } from "../schemas.ts";
import { requireDataset, requireTarget } from "./helpers.ts";
import type { Transform } from "./types.ts";

/**
 * Point one target input field at a source, for one dataset.
 */
export const setTargetMapping: Transform<SetMappingPayload, { targetId: string }> = ({
  state,
  payload,
}) => {
  const { targetId, datasetId, inputField, mapping } = setMappingPayloadSchema.parse(payload);
  requireTarget({ state, targetId });
  requireDataset({ state, datasetId });

  return {
    state: {
      ...state,
      targets: state.targets.map((target) =>
        target.id === targetId
          ? {
              ...target,
              mappings: {
                ...target.mappings,
                [datasetId]: {
                  ...target.mappings[datasetId],
                  [inputField]: mapping,
                },
              },
            }
          : target,
      ),
    },
    result: { targetId },
  };
};
