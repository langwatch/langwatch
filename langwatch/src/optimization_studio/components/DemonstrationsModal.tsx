import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Spinner,
} from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "react-feather";
import type { DatasetColumns } from "../../server/datasets/types";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, NodeDataset, Signature } from "../types/dsl";
import { EditDataset } from "./datasets/EditDataset";
import { fieldsToDatasetColumns } from "../utils/datasetUtils";

export function DemonstrationsModal({
  isOpen,
  onClose,
  node,
}: {
  isOpen: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  const [editingDataset, setEditingDataset] = useState<
    NodeDataset | undefined
  >();

  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const columns = fieldsToDatasetColumns([
      ...(node.data.inputs ?? []),
      ...(node.data.outputs ?? []),
    ]);

    let demonstrations = (node.data as Signature).demonstrations;
    if (
      !demonstrations?.inline ||
      Object.keys(demonstrations.inline.records).length === 0
    ) {
      demonstrations = {
        inline: {
          records: Object.fromEntries(
            columns.map((column) => [column.name, []])
          ),
          columnTypes: columns,
        },
      };
    }
    demonstrations = {
      ...demonstrations,
      inline: {
        ...demonstrations.inline,
        columnTypes: columns,
      } as NodeDataset["inline"],
    };

    setEditingDataset(isOpen ? demonstrations : undefined);
    setRendered(isOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const setSelectedDataset = useCallback(
    (dataset: NodeDataset, _columnTypes: DatasetColumns, close: boolean) => {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          demonstrations: dataset,
        } as Signature,
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
        {rendered ? (
          <>
            <ModalHeader></ModalHeader>
            <ModalBody paddingBottom="32px">
              {isOpen && editingDataset && (
                <EditDataset
                  editingDataset={editingDataset}
                  setEditingDataset={setEditingDataset}
                  setSelectedDataset={setSelectedDataset}
                  title="Demonstrations"
                  cta="Save"
                  hideButtons={true}
                  bottomSpace="268px"
                  loadingOverlayComponent={null}
                />
              )}
            </ModalBody>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
