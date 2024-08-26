import { Box, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import { DEFAULT_DATASET_NAME } from "../../../components/datasets/DatasetTable";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import type { Component, Entry } from "../../types/dsl";
import { DatasetPreview } from "./DatasetPreview";

export function DatasetSelection({
  node,
  setIsEditing,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
  setIsEditing: (isEditing: Entry["dataset"] | undefined) => void;
}) {
  const { project } = useOrganizationTeamProject();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  return (
    <VStack align="start" spacing={12}>
      <VStack align="start" spacing={4}>
        <Heading size="md">Current Dataset</Heading>
        <DatasetSelectionItem
          dataset={(node.data as Entry).dataset}
          onClick={() => {
            setIsEditing((node.data as Entry).dataset);
          }}
        />
      </VStack>
      <VStack align="start" spacing={4}>
        <Heading size="md">Datasets</Heading>
        <HStack spacing={4} wrap="wrap">
          {datasets.data?.map((storedDataset) => {
            const dataset = {
              id: storedDataset.id,
              name: storedDataset.name,
            };

            return (
              <DatasetSelectionItem
                key={dataset.id}
                dataset={dataset}
                onClick={() => {
                  setIsEditing(dataset);
                }}
              />
            );
          })}
        </HStack>
      </VStack>
    </VStack>
  );
}

export function DatasetSelectionItem({
  dataset,
  onClick,
}: {
  dataset: Entry["dataset"];
  onClick: () => void;
}) {
  return (
    <VStack
      align="start"
      width="300px"
      border="1px solid"
      borderRadius="8px"
      borderColor="gray.350"
      background="#F5F7F7"
      className="ag-borderless"
      position="relative"
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        role="button"
        aria-label="Select dataset"
        onClick={onClick}
        zIndex={10}
      />
      <Box width="100%" height="178px" background="#F5F7F7">
        <DatasetPreview
          dataset={dataset}
          borderRadius="6px 6px 0 0"
        />
      </Box>
      <Text fontSize="14px" fontWeight="bold" padding={4}>
        {dataset?.name ?? DEFAULT_DATASET_NAME}
      </Text>
    </VStack>
  );
}
