import { TriggerAction } from "@langwatch/automation-contract";

import type { DatasetSlice } from "./dataset-slice.ts";

export interface NamedDataset {
  id: string;
  name: string;
}

/** The part of a draft the dataset name is read from and written to. */
export interface DatasetNamedDraft {
  action: TriggerAction | null;
  slices: { [TriggerAction.ADD_TO_DATASET]: DatasetSlice };
}

/** The draft with its dataset named, or the same draft when there is nothing
 *  to name: not a dataset delivery, none chosen, already named, or not listed. */
export function withDatasetName<D extends DatasetNamedDraft>({
  draft,
  datasets,
}: {
  draft: D;
  datasets: readonly NamedDataset[] | undefined;
}): D {
  if (draft.action !== TriggerAction.ADD_TO_DATASET) return draft;
  const slice = draft.slices[TriggerAction.ADD_TO_DATASET];
  if (!slice.datasetId || slice.namedDataset?.id === slice.datasetId) return draft;
  const dataset = datasets?.find((d) => d.id === slice.datasetId);
  if (!dataset) return draft;
  return {
    ...draft,
    slices: {
      ...draft.slices,
      [TriggerAction.ADD_TO_DATASET]: {
        ...slice,
        namedDataset: { id: dataset.id, name: dataset.name },
      },
    },
  };
}
