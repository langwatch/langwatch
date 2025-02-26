import { Button, Tabs } from "@chakra-ui/react";
import {
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "react-feather";
import { useDrawer } from "../../components/CurrentDrawer";
import { Dialog } from "../../components/ui/dialog";
import type { DatasetColumns } from "../../server/datasets/types";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, Entry } from "../types/dsl";
import {
  datasetColumnsToFields,
  transposeColumnsFirstToRowsFirstWithId,
} from "../utils/datasetUtils";
import { DatasetSelection } from "./datasets/DatasetSelection";
import { DatasetUpload } from "./datasets/DatasetUpload";
import { EditDataset } from "./datasets/EditDataset";

export function DatasetModal({
  open,
  onClose: onClose_,
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

  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    setEditingDataset(open ? editingDataset_ : undefined);
    setRendered(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const updateNodeInternals = useUpdateNodeInternals();

  const { openDrawer } = useDrawer();

  const initialDataset = useMemo(
    () => (node.data as Entry).dataset,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(node.data as Entry).dataset?.id]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkForUnsavedChanges = (
    newDataset: Entry["dataset"],
    columnTypes: DatasetColumns
  ) => {
    if (
      initialDataset &&
      newDataset &&
      !initialDataset?.id &&
      JSON.stringify(initialDataset.inline) !==
        JSON.stringify(newDataset.inline) &&
      confirm("Want to save this draft dataset?")
    ) {
      openDrawer("addOrEditDataset", {
        datasetToSave: {
          name: newDataset.name,
          columnTypes: columnTypes ?? [],
          datasetRecords: transposeColumnsFirstToRowsFirstWithId(
            newDataset.inline?.records ?? {}
          ),
        },
        onSuccess: (dataset_) => {
          setEditingDataset({ id: dataset_.datasetId, name: dataset_.name });
          setSelectedDataset(
            { id: dataset_.datasetId, name: dataset_.name },
            dataset_.columnTypes,
            false
          );
          onClose_();
        },
      });
      return true;
    }

    return false;
  };

  const onClose = useCallback(() => {
    if (
      editingDataset?.inline &&
      checkForUnsavedChanges(editingDataset, editingDataset.inline.columnTypes)
    ) {
      return;
    }
    onClose_();
  }, [checkForUnsavedChanges, editingDataset, onClose_]);

  const setSelectedDataset = useCallback(
    (
      dataset: Required<Entry>["dataset"],
      columnTypes: DatasetColumns,
      close: boolean
    ) => {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          outputs: datasetColumnsToFields(columnTypes),
          dataset: dataset,
        } as Entry,
      });
      updateNodeInternals(node.id);
      if (close) {
        onClose();
      }
    },
    [setNode, node.id, node.data, updateNodeInternals, onClose]
  );

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content
        css={{
          marginX: "32px",
          marginTop: "32px",
          width: "calc(100vw - 64px)",
          minHeight: "0",
          height: "calc(100vh - 64px)",
          borderRadius: "8px",
          overflowY: "auto",
        }}
      >
        <Dialog.CloseTrigger zIndex={10} />
        {rendered && editingDataset ? (
          <>
            <Dialog.Header>
              <Button
                fontSize="14px"
                fontWeight="bold"
                color="gray.500"
                variant="plain"
                onClick={() => setEditingDataset(undefined)}
              >
                <ArrowLeft size={16} /> Datasets
              </Button>
            </Dialog.Header>
            <Dialog.Body paddingBottom="32px">
              {open && (
                <EditDataset
                  editingDataset={editingDataset}
                  setEditingDataset={setEditingDataset}
                  setSelectedDataset={setSelectedDataset}
                />
              )}
            </Dialog.Body>
          </>
        ) : rendered ? (
          <>
            <Tabs.Root defaultValue="datasets">
              <Dialog.Header>
                <Tabs.List>
                  <Tabs.Trigger value="datasets">Datasets</Tabs.Trigger>
                  <Tabs.Trigger value="upload">Upload</Tabs.Trigger>
                </Tabs.List>
              </Dialog.Header>
              <Dialog.Body paddingBottom="32px">
                <Tabs.Content value="datasets">
                  <DatasetSelection
                    node={node}
                    setIsEditing={setEditingDataset}
                  />
                </Tabs.Content>
                <Tabs.Content value="upload">
                  <DatasetUpload setIsEditing={setEditingDataset} />
                </Tabs.Content>
              </Dialog.Body>
            </Tabs.Root>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
