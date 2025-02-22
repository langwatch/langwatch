import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from "@chakra-ui/react";
import {
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "react-feather";
import { useDrawer } from "../../components/CurrentDrawer";
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
  isOpen,
  onClose: onClose_,
  node,
  editingDataset: editingDataset_ = undefined,
}: {
  isOpen: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
  editingDataset?: Entry["dataset"];
}) {
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();

  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    setEditingDataset(isOpen ? editingDataset_ : undefined);
    setRendered(isOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalOverlay />
      <ModalContent
        marginX="32px"
        marginTop="32px"
        width="calc(100vw - 64px)"
        minHeight="0"
        height="calc(100vh - 64px)"
        borderRadius="8px"
        overflowY="auto"
      >
        <ModalCloseButton zIndex={10} />
        {rendered && editingDataset ? (
          <>
            <ModalHeader>
              <Button
                fontSize="14px"
                fontWeight="bold"
                color="gray.500"
                variant="plain"
                leftIcon={<ArrowLeft size={16} />}
                onClick={() => setEditingDataset(undefined)}
              >
                Datasets
              </Button>
            </ModalHeader>
            <ModalBody paddingBottom="32px">
              {isOpen && (
                <EditDataset
                  editingDataset={editingDataset}
                  setEditingDataset={setEditingDataset}
                  setSelectedDataset={setSelectedDataset}
                />
              )}
            </ModalBody>
          </>
        ) : rendered ? (
          <>
            <Tabs>
              <ModalHeader>
                <TabList>
                  <Tab>Datasets</Tab>
                  <Tab>Upload</Tab>
                </TabList>
              </ModalHeader>
              <ModalBody paddingBottom="32px">
                <TabPanels>
                  <TabPanel>
                    <DatasetSelection
                      node={node}
                      setIsEditing={setEditingDataset}
                    />
                  </TabPanel>
                  <TabPanel>
                    <DatasetUpload setIsEditing={setEditingDataset} />
                  </TabPanel>
                </TabPanels>
              </ModalBody>
            </Tabs>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
