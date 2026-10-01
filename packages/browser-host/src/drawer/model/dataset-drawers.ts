import type { DatasetColumns } from "@langwatch/dataset-contract";

/** What a caller hands dataset's picker drawer: where the picked dataset goes. */
export type UiSelectDatasetDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
};

/** What a caller hands dataset's CSV upload drawer: where the uploaded dataset goes. */
export type UiUploadCsvDrawerProps = {
  onClose?: () => void;
  onSuccess?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
  /** False parses in the browser, for a host that needs the columns before it can continue. */
  enableDirectUpload?: boolean;
};
