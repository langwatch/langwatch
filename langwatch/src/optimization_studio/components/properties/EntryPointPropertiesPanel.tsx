import {
  Box,
  Button,
  HStack,
  Input,
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
  const { rows, columns, total } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  return (
    <BasePropertiesPanel
      node={node}
      outputsTitle="Fields"
      outputsReadOnly
      hideInputs
      hideProperties
    >
      <VStack width="full" align="start">
        <HStack width="full">
          <PropertySectionTitle>
            Dataset{" "}
            {total && (
              <Text as="span" color="gray.400">
                ({total} rows)
              </Text>
            )}
          </PropertySectionTitle>
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
          minHeight={`${36 + 29 * (rows?.length ?? 0)}px`}
        />
      </VStack>
      <DatasetModal
        isOpen={isOpen}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
      <VStack width="full" align="start">
        <HStack width="full">
          <PropertySectionTitle>Manual Test Entry</PropertySectionTitle>
          <Tooltip label="When manually running the full workflow, a single entry from the dataset will be used, choose which one to pick.">
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
      <HStack width="full">
        <VStack width="full" align="start">
          <HStack width="full">
            <PropertySectionTitle>Optimization/Test Split</PropertySectionTitle>
            <Tooltip
              label={`During optimization, a bigger part of the dataset is used for optimization and a smaller part for testing, this guarantees that the test set is not leaked into the optimization, preventing the LLM to "cheat" it's way into a better score.`}
            >
              <Box paddingTop={1}>
                <Info size={14} />
              </Box>
            </Tooltip>
          </HStack>
          <Select
            value={(node.data as Entry).train_test_split ?? "0.2"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const trainTestSplit = parseFloat(e.target.value);
              setNode({
                id: node.id,
                data: {
                  ...node.data,
                  train_test_split: trainTestSplit,
                },
              });
            }}
          >
            <option value="0.1">90% optimization, 10% test</option>
            <option value="0.2">80% optimization, 20% test</option>
            <option value="0.3">70% optimization, 30% test</option>
            <option value="0.4">60% optimization, 40% test</option>
            <option value="0.5">50% optimization, 50% test</option>
          </Select>
        </VStack>
        <VStack align="start" width="40%">
          <HStack width="full">
            <PropertySectionTitle>Seed</PropertySectionTitle>
            <Tooltip
              label={`For making sure the original dataset order does not affect performance, a seed is used to shuffle it before the split.`}
            >
              <Box paddingTop={1}>
                <Info size={14} />
              </Box>
            </Tooltip>
          </HStack>
          <Input
            type="number"
            required
            value={(node.data as Entry).seed ?? "42"}
            min={-1}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const seed = parseInt(e.target.value);
              if (isNaN(seed)) return;
              setNode({
                id: node.id,
                data: {
                  ...node.data,
                  seed: seed,
                },
              });
            }}
          />
        </VStack>
      </HStack>
    </BasePropertiesPanel>
  );
}
