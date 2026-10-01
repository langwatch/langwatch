/**
 * Dataset dialog for the workflow entry-point node: same experience as the rest of the
 * platform: the shared dataset picker for choosing, the shared TanStack editor for
 * editing.
 */
import { Box, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import {
  datasetColumnsSchema,
  type DatasetColumns,
  type InMemoryDataset,
} from "@langwatch/dataset-contract";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import {
  datasetColumnsToFields,
  inMemoryDatasetToNodeDataset,
} from "@langwatch/workflow-browser-kit";
import type { Component, Entry } from "@langwatch/workflow-contract";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";
import type { Node, NodeProps } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import type React from "react";
import { useRef, useState } from "react";
import { ArrowLeft, Database, Plus, Upload } from "react-feather";

import { DatasetEditorTable } from "../../../behavior/optimization_studio/lent-dataset-editor-table.tsx";
import { DatasetPickerList } from "../../../behavior/optimization_studio/lent-dataset-picker-list.tsx";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";

const DRAFT_DATASET_COLUMNS: DatasetColumns = [
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
];

/**
 * The editor for the dataset being edited: the saved one by id, the draft one held
 * inline, and nothing at all while the dialog is closed.
 */
function DatasetEditorBody({
  attachDataset,
  editingDataset,
  editorPortalRef,
  onDraftChange,
  onSaveDraftAsDataset,
  open,
}: {
  attachDataset: (dataset: Entry["dataset"], columnTypes: DatasetColumns) => void;
  editingDataset: NonNullable<Entry["dataset"]>;
  editorPortalRef: React.RefObject<HTMLDivElement | null>;
  onDraftChange: (dataset: InMemoryDataset) => void;
  onSaveDraftAsDataset: () => void;
  open: boolean;
}) {
  if (!open) return null;

  if (editingDataset.id) {
    return (
      <DatasetEditorTable
        datasetId={editingDataset.id}
        editorPortalRef={editorPortalRef}
        floatingSelectionBar
        onColumnsChanged={(columnTypes) => {
          attachDataset(editingDataset, datasetColumnsSchema.parse(columnTypes));
        }}
      />
    );
  }

  const inline = editingDataset.inline;
  if (!inline) return null;

  return (
    <DatasetEditorTable
      title={editingDataset.name ?? "Draft Dataset"}
      editorPortalRef={editorPortalRef}
      floatingSelectionBar
      inMemoryDataset={{
        name: editingDataset.name,
        columnTypes: inline.columnTypes,
        datasetRecords: transposeColumnsFirstToRowsFirstWithId(inline.records),
      }}
      onUpdateDataset={(dataset) =>
        onDraftChange({ ...dataset, columnTypes: datasetColumnsSchema.parse(dataset.columnTypes) })
      }
      headerActions={
        <Button
          size="sm"
          colorPalette="blue"
          variant="outline"
          data-testid="save-draft-as-dataset"
          onClick={onSaveDraftAsDataset}
        >
          <Database size={14} /> Save as dataset
        </Button>
      }
    />
  );
}

export function DatasetModal({
  open,
  onClose,
  node,
  editingDataset: editingDataset_,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
  editingDataset?: Entry["dataset"];
}) {
  const [editingDataset, setEditingDataset] = useState<Entry["dataset"] | undefined>();
  const editorPortalRef = useRef<HTMLDivElement | null>(null);
  const { openDrawer } = useDrawer();
  const updateNodeInternals = useUpdateNodeInternals();

  const [openFrom, setOpenFrom] = useState<boolean | null>(null);
  if (openFrom !== open) {
    setOpenFrom(open);
    setEditingDataset(open ? editingDataset_ : undefined);
  }

  const { attachEntryDataset } = useWorkflowStore(({ attachEntryDataset }) => ({
    attachEntryDataset,
  }));

  const attachDataset = (dataset: Entry["dataset"], columnTypes: DatasetColumns) => {
    attachEntryDataset(node.id, dataset, datasetColumnsToFields(columnTypes));
    updateNodeInternals(node.id);
  };

  const handlePick = (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => {
    attachDataset({ id: dataset.datasetId, name: dataset.name }, dataset.columnTypes);
    onClose();
  };

  // The workflow node needs the dataset's columns straight away, which a direct upload
  // still processing doesn't have yet, so the upload keeps the in-browser parse.
  const handleUploadCsv = () => {
    openDrawer("uploadCSV", { enableDirectUpload: false, onSuccess: handlePick });
  };

  const handleNewDraft = () => {
    const draft: Entry["dataset"] = {
      name: "Draft Dataset",
      inline: {
        records: Object.fromEntries(DRAFT_DATASET_COLUMNS.map((col) => [col.name, ["", "", ""]])),
        columnTypes: DRAFT_DATASET_COLUMNS,
      },
    };
    attachDataset(draft, DRAFT_DATASET_COLUMNS);
    setEditingDataset(draft);
  };

  const handleDraftChange = (dataset: InMemoryDataset) => {
    const nodeDataset = inMemoryDatasetToNodeDataset({
      ...dataset,
      name: editingDataset?.name ?? dataset.name,
    });
    attachDataset(nodeDataset, dataset.columnTypes);
    setEditingDataset(nodeDataset);
  };

  const handleSaveDraftAsDataset = () => {
    if (!editingDataset?.inline) return;
    openDrawer("addOrEditDataset", {
      datasetToSave: {
        name: editingDataset.name,
        columnTypes: editingDataset.inline.columnTypes,
        datasetRecords: transposeColumnsFirstToRowsFirstWithId(editingDataset.inline.records),
      },
      onSuccess: (saved: { datasetId: string; name: string; columnTypes: DatasetColumns }) => {
        attachDataset({ id: saved.datasetId, name: saved.name }, saved.columnTypes);
        onClose();
      },
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()} size="full">
      <Dialog.Content
        bg="bg"
        css={{
          marginX: "32px",
          marginTop: "32px",
          width: "calc(100vw - 64px)",
          minHeight: "0",
          height: "calc(100vh - 64px)",
          borderRadius: "8px",
          overflowY: "auto",
        }}
        data-testid="dataset-modal"
      >
        <Dialog.CloseTrigger zIndex={10} />
        {editingDataset ? (
          <>
            <Dialog.Header>
              <HStack width="full" paddingRight={10}>
                <Button
                  fontSize="14px"
                  fontWeight="bold"
                  color="fg.muted"
                  variant="plain"
                  data-testid="back-to-datasets"
                  onClick={() => setEditingDataset(undefined)}
                >
                  <ArrowLeft size={16} /> Datasets
                </Button>
              </HStack>
            </Dialog.Header>
            <Dialog.Body paddingBottom="32px">
              <Box ref={editorPortalRef} width="full" height="full">
                <DatasetEditorBody
                  open={open}
                  editingDataset={editingDataset}
                  editorPortalRef={editorPortalRef}
                  attachDataset={attachDataset}
                  onDraftChange={handleDraftChange}
                  onSaveDraftAsDataset={handleSaveDraftAsDataset}
                />
              </Box>
            </Dialog.Body>
          </>
        ) : (
          <>
            <Dialog.Header>
              <HStack gap={2}>
                <Database size={20} />
                <Text fontSize="lg" fontWeight="semibold">
                  Choose dataset
                </Text>
              </HStack>
            </Dialog.Header>
            <Dialog.Body paddingBottom="32px" display="flex" flexDirection="column">
              <HStack paddingBottom={4}>
                <Text color="fg.muted" fontSize="sm">
                  Pick an existing dataset for this workflow, upload a CSV, or start a new draft.
                </Text>
                <Spacer />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="upload-csv-dataset"
                  onClick={handleUploadCsv}
                >
                  <Upload size={14} /> Upload CSV
                </Button>
                <Button
                  size="sm"
                  colorPalette="blue"
                  data-testid="new-draft-dataset"
                  onClick={handleNewDraft}
                >
                  <Plus size={14} /> New dataset
                </Button>
              </HStack>
              {open && <DatasetPickerList enabled={open} onSelect={handlePick} />}
            </Dialog.Body>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
