import { Button, HStack, Spacer, Text, useDisclosure } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useState } from "react";
import { Folder } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";

export function EntryPointPropertiesPanel({ node }: { node: Node<Component> }) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const { rows, columns } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });

  return (
    <BasePropertiesPanel node={node}>
      <HStack width="full">
        <PropertySectionTitle>Dataset</PropertySectionTitle>
        <Spacer />
        <Button
          size="xs"
          variant="ghost"
          marginBottom={-1}
          leftIcon={<Folder size={14} />}
          onClick={() => {
            setEditingDataset(undefined);
            onOpen();
          }}
        >
          <Text>Choose...</Text>
        </Button>
      </HStack>
      <DatasetPreview
        rows={rows}
        columns={columns.map((column) => ({
          name: column.name,
          type: "string",
        }))}
        onClick={() => {
          setEditingDataset((node.data as Entry).dataset);
          onOpen();
        }}
      />
      <DatasetModal
        isOpen={isOpen}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
    </BasePropertiesPanel>
  );
}
