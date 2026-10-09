import { useEffect } from "react";
import { TriggerAction } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import type { AutomationDraft, DraftAction } from "../../logic/draftReducer";

type NamedDataset = { id: string; name: string };

/** The draft with its dataset named, or the same draft when there is nothing
 *  to name: not a dataset delivery, none chosen, already named, or not listed. */
export function withDatasetName({
  draft,
  datasets,
}: {
  draft: AutomationDraft;
  datasets: ReadonlyArray<NamedDataset> | undefined;
}): AutomationDraft {
  if (draft.action !== TriggerAction.ADD_TO_DATASET) return draft;
  const slice = draft.slices[TriggerAction.ADD_TO_DATASET];
  if (!slice.datasetId || slice.namedDataset?.id === slice.datasetId) {
    return draft;
  }
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

/** Names the draft's dataset whenever the list has it, so the review line reads
 *  "dataset <name>" without the dataset step ever opening. */
export function useDatasetName({
  projectId,
  draft,
  dispatch,
}: {
  projectId: string;
  draft: AutomationDraft;
  dispatch: (action: DraftAction) => void;
}): void {
  const isDataset =
    draft.action === TriggerAction.ADD_TO_DATASET &&
    !!draft.slices[TriggerAction.ADD_TO_DATASET].datasetId;
  // Same input as the dataset step's own query, so the two share one cache.
  const list = api.dataset.getAll.useQuery(
    { projectId },
    { enabled: !!projectId && isDataset, refetchOnWindowFocus: false },
  );
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
