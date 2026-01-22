/**
 * Utilities to convert between store FieldMapping and UI FieldMapping formats.
 */

import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import type { FieldMapping as StoreFieldMapping } from "../types";

/**
 * Convert store FieldMapping to UI FieldMapping format.
 * Used when displaying mappings in the UI.
 */
export const convertToUIMapping = (
  mapping: StoreFieldMapping,
): UIFieldMapping => {
  if (mapping.type === "value") {
    return { type: "value", value: mapping.value };
  }
  return {
    type: "source",
    sourceId: mapping.sourceId,
    path: [mapping.sourceField],
  };
};

/**
 * Convert UI FieldMapping to store FieldMapping format.
 * Used when saving mappings from the UI to the store.
 *
 * @param mapping - The UI mapping to convert
 * @param isDatasetSource - Function to check if a sourceId refers to a dataset
 */
export const convertFromUIMapping = (
  mapping: UIFieldMapping,
  isDatasetSource: (sourceId: string) => boolean,
): StoreFieldMapping => {
  if (mapping.type === "value") {
    return { type: "value", value: mapping.value };
  }
  return {
    type: "source",
    source: isDatasetSource(mapping.sourceId) ? "dataset" : "target",
    sourceId: mapping.sourceId,
    sourceField: mapping.path.join("."),
  };
};
