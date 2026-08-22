import { type SetMappingPayload, setMappingPayloadSchema } from "../schemas";
import { requireTarget } from "./helpers";
import type { Transform } from "./types";

/**
 * Point one target input field at a source, for one dataset.
 *
 * Mappings are per dataset because the same field is rarely called the same
 * thing in two datasets.
 */
export const setTargetMapping: Transform<
  SetMappingPayload,
  { targetId: string }
> = ({ state, payload }) => {
  const { targetId, datasetId, inputField, mapping } =
    setMappingPayloadSchema.parse(payload);
  requireTarget({ state, targetId });

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
                  ...(target.mappings[datasetId] ?? {}),
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
