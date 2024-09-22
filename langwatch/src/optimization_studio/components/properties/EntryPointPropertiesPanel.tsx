import {
  Box,
  Button,
  HStack,
  Select,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useState } from "react";
import { Folder, Info } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

export function EntryPointPropertiesPanel({ node }: { node: Node<Component> }) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const { rows, columns } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

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
      <VStack width="full" align="start">
        <HStack width="full">
          <PropertySectionTitle>Test Entry</PropertySectionTitle>
          <Tooltip label="Select which entry to choose from the dataset when executing a single test run of the workflow.">
            <Box paddingTop={1}>
              <Info size={14} />
            </Box>
          </Tooltip>
        </HStack>
        <Select
          value={(node.data as Entry).entry_selection}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const entrySelection = e.target.value as Entry["entry_selection"];
            setNode({
              id: node.id,
              data: {
                ...node.data,
                entry_selection: entrySelection,
              },
            });
          }}
        >
          <option value="first">First</option>
          <option value="last">Last</option>
          <option value="random">Random</option>
        </Select>
      </VStack>
    </BasePropertiesPanel>
  );
}
