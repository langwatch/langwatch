/**
 * Dataset Picker Panel
 *
 * Side panel for choosing an existing dataset.
 */

import {
  Box,
  Button,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuDatabase, LuX } from "react-icons/lu";
import { Drawer, DrawerFooter } from "../../../../components/ui/drawer";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import type { DatasetColumn } from "../../types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function DatasetPickerPanel({ isOpen, onClose }: Props) {
  const { project } = useOrganizationTeamProject();
  const { switchToSavedDataset } = useEvaluationV3Store(
    useShallow((s) => ({
      switchToSavedDataset: s.switchToSavedDataset,
    }))
  );

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen }
  );

  const handleSelectDataset = (dataset: {
    id: string;
    name: string;
    columnTypes: Record<string, string>;
  }) => {
    const columns: DatasetColumn[] = Object.entries(dataset.columnTypes).map(
      ([name, type]) => ({
        id: name,
        name,
        type: type as DatasetColumn["type"],
      })
    );

    switchToSavedDataset(dataset.id, dataset.name, columns);
    onClose();
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      placement="end"
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <Drawer.Title>Choose Dataset</Drawer.Title>
          <Drawer.CloseTrigger asChild>
            <Button variant="ghost" size="sm" position="absolute" right={4} top={4}>
              <LuX />
            </Button>
          </Drawer.CloseTrigger>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={3} align="stretch">
            <Text color="gray.600" fontSize="sm">
              Select an existing dataset to use for this evaluation.
            </Text>

            {datasets.isLoading ? (
              <VStack gap={2}>
                <Skeleton height="60px" width="full" />
                <Skeleton height="60px" width="full" />
                <Skeleton height="60px" width="full" />
              </VStack>
            ) : datasets.data?.length === 0 ? (
              <Box
                padding={6}
                textAlign="center"
                background="gray.50"
                borderRadius="md"
              >
                <LuDatabase size={32} color="gray" />
                <Text marginTop={2} color="gray.600">
                  No datasets found
                </Text>
                <Text fontSize="sm" color="gray.500">
                  Create a dataset first or use the inline dataset editor
                </Text>
              </Box>
            ) : (
              datasets.data?.map((dataset) => (
                <Box
                  key={dataset.id}
                  padding={4}
                  border="1px solid"
                  borderColor="gray.200"
                  borderRadius="md"
                  cursor="pointer"
                  _hover={{ borderColor: "blue.400", background: "blue.50" }}
                  onClick={() => handleSelectDataset({
                    id: dataset.id,
                    name: dataset.name,
                    columnTypes: dataset.columnTypes as Record<string, string>,
                  })}
                >
                  <HStack gap={3}>
                    <LuDatabase size={20} color="var(--chakra-colors-blue-500)" />
                    <VStack align="start" gap={0} flex={1}>
                      <Text fontWeight="medium">{dataset.name}</Text>
                      <Text fontSize="sm" color="gray.500">
                        {Object.keys(dataset.columnTypes ?? {}).length} columns
                      </Text>
                    </VStack>
                  </HStack>
                </Box>
              ))
            )}
          </VStack>
        </Drawer.Body>
        <DrawerFooter borderTopWidth="1px" gap={3}>
          <Box flex={1} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      </Drawer.Content>
    </Drawer.Root>
  );
}

