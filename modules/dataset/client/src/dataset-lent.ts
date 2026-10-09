/** Dataset UI lent by token to the modules that pick, create, edit and sync datasets (§10.1). */

import type { DatasetColumn, DatasetColumns } from "@langwatch/dataset-contract";
import { uiTokens } from "@langwatch/module";
import type { ReactNode } from "react";

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

/** A dataset a borrower holds in memory, with plain columns, as dataset's lent editor reads it. */
export type DatasetEditorTableDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: ({ id: string } & Record<string, unknown>)[];
  columnTypes: DatasetColumn[];
};

/** What a screen hands dataset's lent editor table: a saved dataset by id, or one in memory. */
export type DatasetEditorTableProps = {
  datasetId?: string;
  inMemoryDataset?: DatasetEditorTableDataset;
  onUpdateDataset?: (dataset: DatasetEditorTableDataset & { datasetId?: string }) => void;
  title?: ReactNode;
  headerActions?: ReactNode;
  readEnabled?: boolean;
  floatingSelectionBar?: boolean;
  /** Called after column changes are saved, so the host can follow the new shape. */
  onColumnsChanged?: (columnTypes: DatasetColumn[]) => void;
  /** The dialog's portal target, so the floating cell editor stays inside its pointer scope. */
  editorPortalRef?: { readonly current: HTMLDivElement | null };
};

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

const tokens = uiTokens("dataset");

export const AddOrEditDatasetDrawerToken =
  tokens.component<AddOrEditDatasetDrawerProps>("addOrEditDatasetDrawer");
export const DatasetPickerListToken = tokens.component<DatasetPickerListProps>("datasetPickerList");
export const DatasetRecordSyncToken = tokens.component<DatasetRecordSyncProps>("datasetRecordSync");
export const DatasetEditorTableToken =
  tokens.component<DatasetEditorTableProps>("datasetEditorTable");

/** Dataset's drawers another module opens, by token. */
export const AddOrEditDatasetRoutedDrawerToken =
  tokens.drawer<AddOrEditDatasetDrawerProps>("addOrEditDataset");
export const SelectDatasetDrawerToken = tokens.drawer<UiSelectDatasetDrawerProps>("selectDataset");
export const UploadCsvDrawerToken = tokens.drawer<UiUploadCsvDrawerProps>("uploadCSV");
