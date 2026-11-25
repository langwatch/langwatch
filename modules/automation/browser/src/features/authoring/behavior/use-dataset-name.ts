import { TriggerAction } from "@langwatch/automation-contract";
import { useEffect } from "react";

import { useProjectDatasets } from "../../../behavior/use-automation-reads.ts";
import { type DatasetNamedDraft, withDatasetName } from "../model/dataset-name.ts";
import type { DatasetSlice } from "../model/dataset-slice.ts";

/** Names the draft's dataset whenever the list has it, so the review line reads
 *  "dataset <name>" without the dataset step ever opening. */
export function useDatasetName({
  projectId,
  draft,
  dispatch,
}: {
  projectId: string;
  draft: DatasetNamedDraft;
  dispatch: (action: {
    type: "SET_SLICE";
    action: typeof TriggerAction.ADD_TO_DATASET;
    slice: DatasetSlice;
  }) => void;
}): void {
  const isDataset =
    draft.action === TriggerAction.ADD_TO_DATASET &&
    !!draft.slices[TriggerAction.ADD_TO_DATASET].datasetId;
  // Same input as the dataset step's own query, so the two share one cache.
  const list = useProjectDatasets({ projectId, enabled: isDataset });
  useEffect(() => {
    const named = withDatasetName({ draft, datasets: list.data });
    if (named === draft) return;
    dispatch({
      type: "SET_SLICE",
      action: TriggerAction.ADD_TO_DATASET,
      slice: named.slices[TriggerAction.ADD_TO_DATASET],
    });
  }, [draft, list.data, dispatch]);
}
