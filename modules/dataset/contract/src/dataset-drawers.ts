/** Dataset's drawers another module opens, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/kernel/contract";

import type { DatasetColumns } from "./dataset.ts";

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

const drawers = uiTokens("dataset");

export const SelectDatasetDrawerToken = drawers.drawer<UiSelectDatasetDrawerProps>("selectDataset");
export const UploadCsvDrawerToken = drawers.drawer<UiUploadCsvDrawerProps>("uploadCSV");
