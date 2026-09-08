/**
 * Adapter that backs the shared dataset table cells with the evaluations workbench
 * store. The cells (EditableCell, TableCell) only know the narrow DatasetTableContext
 * contract; this provider maps the workbench's zustand state onto it.
 */
import type { PropsWithChildren } from "react";

import {
  type DatasetTableContextValue,
  DatasetTableProvider,
} from "@langwatch/dataset-web/surfaces/dataset-table";
import { useDatasetAttachmentUpload } from "@langwatch/dataset-web/surfaces/dataset-attachment-upload";
import { renderDatasetImage } from "@langwatch/dataset-web/surfaces/render-dataset-image";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";

export function EvaluationsV3DatasetTableProvider({ children }: PropsWithChildren) {
  const { project } = useOrganizationTeamProject();
  // The workbench edits an inline dataset with no saved id, and the upload is
  // project-scoped, so a row of an unsaved dataset stores bytes the same way.
  const uploadAttachment = useDatasetAttachmentUpload({ projectId: project?.id });
  const state: DatasetTableContextValue = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    expandedCells: state.ui.expandedCells,
    editingCell: state.ui.editingCell,
    selectedCell: state.ui.selectedCell,
    setCellValue: state.setCellValue,
    setEditingCell: state.setEditingCell,
    setSelectedCell: state.setSelectedCell,
    toggleCellExpanded: state.toggleCellExpanded,
    toggleRowSelection: state.toggleRowSelection,
    renderImage: renderDatasetImage,
  }));

  const value: DatasetTableContextValue = { ...state, uploadAttachment };

  return <DatasetTableProvider value={value}>{children}</DatasetTableProvider>;
}
