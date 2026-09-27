import type { DatasetColumns } from "@langwatch/dataset-contract";

/** What a caller hands dataset's picker drawer: where the picked dataset goes. */
export type UiSelectDatasetDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
};
