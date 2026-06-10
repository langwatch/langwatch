/**
 * Dataset dialog for the workflow entry-point node — same experience as the
 * rest of the platform: the shared dataset picker for choosing, the shared
 * TanStack editor for editing.
 *
 * Two views:
 *  - Choose (no `editingDataset`): searchable picker list + "Upload CSV" +
 *    "New dataset" (drafts an inline dataset on the node and jumps straight
 *    into the editor — no form, no forced CSV upload).
 *  - Edit (`editingDataset` set): the shared editor. Saved datasets autosave
 *    records and propagate column changes into the node's fields; draft
 *    datasets live in the workflow DSL itself and can be promoted to a real
 *    dataset with "Save as dataset".
 *
 * All node writes go through `attachEntryDataset`, which merges dataset
 * columns into the entry fields without clobbering user-added inputs — the
 * dataset is a data source, not the definition of the workflow's inputs.
 */
import { Box, Button, HStack, Spacer, Text, useDisclosure } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Database, Plus, Upload } from "react-feather";

import { DatasetPickerList } from "~/components/datasets/DatasetPickerList";
import {
  DatasetEditorTable,
  type InMemoryDataset,
} from "~/components/datasets/editor/DatasetEditorTable";
import { UploadCSVModal } from "~/components/datasets/UploadCSVModal";
import { useDrawer } from "~/hooks/useDrawer";
import type { DatasetColumns } from "~/server/datasets/types";
import { Dialog } from "../../components/ui/dialog";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, Entry } from "../types/dsl";
import {
  datasetColumnsToFields,
  inMemoryDatasetToNodeDataset,
  transposeColumnsFirstToRowsFirstWithId,
} from "../utils/datasetUtils";

const DRAFT_DATASET_COLUMNS: DatasetColumns = [
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
];

export function DatasetModal({
  open,
  onClose,
  node,
  editingDataset: editingDataset_ = undefined,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
  editingDataset?: Entry["dataset"];
}) {
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const editorPortalRef = useRef<HTMLDivElement | null>(null);
  const uploadCSVModal = useDisclosure();
  const { openDrawer } = useDrawer();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    setEditingDataset(open ? editingDataset_ : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { attachEntryDataset } = useWorkflowStore(
    ({ attachEntryDataset }) => ({ attachEntryDataset }),
  );

  const attachDataset = (
    dataset: Entry["dataset"],
    columnTypes: DatasetColumns,
  ) => {
    attachEntryDataset(
      node.id,
      dataset,
      datasetColumnsToFields(columnTypes),
    );
    updateNodeInternals(node.id);
  };

  const handlePick = (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => {
    attachDataset(
      { id: dataset.datasetId, name: dataset.name },
      dataset.columnTypes,
    );
    onClose();
  };

  const handleNewDraft = () => {
    const draft: Entry["dataset"] = {
      name: "Draft Dataset",
      inline: {
        records: Object.fromEntries(
          DRAFT_DATASET_COLUMNS.map((col) => [col.name, ["", "", ""]]),
        ),
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
        datasetRecords: transposeColumnsFirstToRowsFirstWithId(
          editingDataset.inline.records,
        ),
      },
      onSuccess: (saved: {
        datasetId: string;
        name: string;
        columnTypes: DatasetColumns;
      }) => {
        attachDataset({ id: saved.datasetId, name: saved.name }, saved.columnTypes);
        onClose();
      },
    });
  };

  const isDraft = !!editingDataset && !editingDataset.id;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && onClose()}
      size="full"
    >
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
                <Spacer />
                {isDraft && (
                  <Button
                    size="sm"
                    colorPalette="blue"
                    variant="outline"
                    data-testid="save-draft-as-dataset"
                    onClick={handleSaveDraftAsDataset}
                  >
                    <Database size={14} /> Save as dataset
                  </Button>
                )}
              </HStack>
            </Dialog.Header>
            <Dialog.Body paddingBottom="32px">
              <Box ref={editorPortalRef} width="full" height="full">
                {open && editingDataset.id ? (
                  <DatasetEditorTable
                    datasetId={editingDataset.id}
                    editorPortalRef={editorPortalRef}
                    onColumnsChanged={(columnTypes) => {
                      attachDataset(editingDataset, columnTypes);
                    }}
                  />
                ) : open && editingDataset.inline ? (
                  <DatasetEditorTable
                    title={editingDataset.name ?? "Draft Dataset"}
                    editorPortalRef={editorPortalRef}
                    inMemoryDataset={{
                      name: editingDataset.name,
                      columnTypes: editingDataset.inline.columnTypes,
                      datasetRecords: transposeColumnsFirstToRowsFirstWithId(
                        editingDataset.inline.records,
                      ),
                    }}
                    onUpdateDataset={handleDraftChange}
                  />
                ) : null}
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
            <Dialog.Body
              paddingBottom="32px"
              display="flex"
              flexDirection="column"
            >
              <HStack paddingBottom={4}>
                <Text color="fg.muted" fontSize="sm">
                  Pick an existing dataset for this workflow, upload a CSV, or
                  start a new draft.
                </Text>
                <Spacer />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="upload-csv-dataset"
                  onClick={() => uploadCSVModal.onOpen()}
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
              {open && (
                <DatasetPickerList enabled={open} onSelect={handlePick} />
              )}
            </Dialog.Body>
          </>
        )}
      </Dialog.Content>
      {uploadCSVModal.open && (
        <UploadCSVModal
          isOpen={uploadCSVModal.open}
          onClose={uploadCSVModal.onClose}
          onSuccess={(dataset) => {
            uploadCSVModal.onClose();
            handlePick({
              datasetId: dataset.datasetId,
              name: dataset.name,
              columnTypes: dataset.columnTypes,
            });
          }}
        />
      )}
    </Dialog.Root>
  );
}
