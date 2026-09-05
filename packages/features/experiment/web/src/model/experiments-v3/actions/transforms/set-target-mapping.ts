import { type SetMappingPayload, setMappingPayloadSchema } from "../schemas";
import { requireDataset, requireTarget } from "./helpers";
import type { Transform } from "./types";

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
