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
import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "react-feather";
import type { DatasetColumns } from "../../server/datasets/types";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, Entry } from "../types/dsl";
import { datasetColumnsToFieldTypes } from "../utils/datasetUtils";
import { DatasetSelection } from "./datasets/DatasetSelection";
import { DatasetUpload } from "./datasets/DatasetUpload";
import { EditDataset } from "./datasets/EditDataset";

export function DatasetModal({
  isOpen,
  onClose,
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

  useEffect(() => {
    setEditingDataset(editingDataset_);
  }, [editingDataset_]);

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const setSelectedDataset = useCallback(
    (
      dataset: Required<Entry>["dataset"],
      columnTypes: DatasetColumns,
      close: boolean
    ) => {
      if (close && dataset.id && !(node.data as Entry).dataset?.id) {
        if (
          !confirm("The current draft dataset will be discarded. Are you sure?")
        ) {
          return;
        }
      }
      setNode({
        id: node.id,
        data: {
          ...node.data,
          outputs: datasetColumnsToFieldTypes(columnTypes),
          dataset: dataset,
        } as Entry,
      });
      if (close) {
        onClose();
      }
    },
    [node.data, node.id, setNode, onClose]
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
        {editingDataset ? (
          <>
            <ModalHeader>
              <Button
                fontSize="14px"
                fontWeight="bold"
                color="gray.500"
                variant="link"
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
        ) : (
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
                    <DatasetUpload
                      node={node}
                      setIsEditing={setEditingDataset}
                    />
                  </TabPanel>
                </TabPanels>
              </ModalBody>
            </Tabs>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
