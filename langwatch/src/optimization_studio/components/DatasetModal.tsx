import {
  Button,
  Center,
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
  Text,
} from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { ArrowLeft } from "react-feather";
import type { Component, Entry } from "../types/dsl";
import { DatasetSelection } from "./datasets/DatasetSelection";
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
              {isOpen && <EditDataset node={node as Node<Entry>} />}
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
                    <DatasetUpload node={node} />
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

export function DatasetUpload({
  node,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  return (
    <Center>
      <Text>Upload</Text>
    </Center>
  );
}
