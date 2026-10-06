/** Dataset UI lent by token to the modules that pick, create and sync datasets (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { DatasetColumn } from "./dataset.ts";

/** What a screen hands dataset's lent create-or-edit drawer. */
export type AddOrEditDatasetDrawerProps = {
  datasetToSave?: {
    datasetId?: string;
    name?: string;
    columnTypes: DatasetColumn[];
    datasetRecords?: ({ id?: string } & Record<string, unknown>)[];
  };
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumn[] }) => void;
  /** Apply the form without saving it: the caller holds the dataset in memory. */
  localOnly?: boolean;
  columnVisibility?: {
    hiddenColumns: Set<string>;
    onToggleVisibility: (columnName: string) => void;
  };
  isColumnsLocked?: boolean;
};

/** What a screen hands dataset's lent picker list: whether to fetch yet, and where a pick goes. */
export type DatasetPickerListProps = {
  enabled?: boolean;
  onSelect: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumn[] }) => void;
};

/** What a screen hands dataset's lent record sync, which renders nothing and saves edits. */
export type DatasetRecordSyncProps = {
  projectId: string | undefined;
  /** dbDatasetId -> recordId -> changed columns; `_delete: true` marks a deletion. */
  pendingSavedChanges: Record<string, Record<string, Record<string, unknown>>>;
  resolveFullRecord: (
    dbDatasetId: string,
    recordId: string,
  ) => ({ id: string } & Record<string, unknown>) | undefined;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  onStatus: (state: "idle" | "saving" | "saved" | "error", error?: string) => void;
};

export const AddOrEditDatasetDrawerToken =
  uiTokens("dataset").component<AddOrEditDatasetDrawerProps>("addOrEditDatasetDrawer");
export const DatasetPickerListToken =
  uiTokens("dataset").component<DatasetPickerListProps>("datasetPickerList");
export const DatasetRecordSyncToken =
  uiTokens("dataset").component<DatasetRecordSyncProps>("datasetRecordSync");
