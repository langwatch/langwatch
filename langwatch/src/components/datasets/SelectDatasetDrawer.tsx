import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { Database, Search } from "react-feather";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DatasetColumns } from "~/server/datasets/types";
import { api } from "~/utils/api";

export type SelectDatasetDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => void;
};

/**
 * Drawer for selecting an existing dataset from the project.
 * Features:
 * - Quick search filter
 * - Shows dataset name and column count
 * - Shows last edit date
 * - Reusable across the app via useDrawer
 */
export function SelectDatasetDrawer(props: SelectDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as SelectDatasetDrawerProps["onSelect"]);
  // Note: props.open can be a string (drawer name) from CurrentDrawer, convert to boolean
  const isOpen = props.open !== false && props.open !== undefined;

  const [searchQuery, setSearchQuery] = useState("");

  const datasetsQuery = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  const filteredDatasets = useMemo(() => {
    if (!datasetsQuery.data) return [];

    const query = searchQuery.toLowerCase().trim();
    if (!query) return datasetsQuery.data;

    return datasetsQuery.data.filter((dataset) =>
      dataset.name.toLowerCase().includes(query),
    );
  }, [datasetsQuery.data, searchQuery]);

  const handleSelectDataset = (dataset: (typeof filteredDatasets)[0]) => {
    onSelect?.({
      datasetId: dataset.id,
      name: dataset.name,
      columnTypes: dataset.columnTypes as DatasetColumns,
    });
    onClose();
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            <Database size={20} />
            <Text fontSize="xl" fontWeight="semibold">
              Choose Dataset
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select an existing dataset to use for this evaluation.
            </Text>

            {/* Search input - fixed at top */}
            <Box position="relative" paddingX={6}>
              <Box
                position="absolute"
                left={9}
                top="50%"
                transform="translateY(-50%)"
                color="fg.subtle"
                zIndex={1}
              >
                <Search size={16} />
              </Box>
              <Input
                placeholder="Search datasets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                paddingLeft={10}
              />
            </Box>

            {/* Dataset list - scrollable */}
            <VStack
              gap={2}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingBottom={4}
            >
              {datasetsQuery.isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : filteredDatasets.length === 0 ? (
                <Box paddingY={8} textAlign="center" color="fg.muted">
                  {searchQuery
                    ? "No datasets match your search"
                    : "No datasets found in this project"}
                </Box>
              ) : (
                filteredDatasets.map((dataset) => (
                  <DatasetCard
                    key={dataset.id}
                    name={dataset.name}
                    columnCount={(dataset.columnTypes as DatasetColumns).length}
                    entryCount={dataset._count.datasetRecords}
                    updatedAt={dataset.updatedAt}
                    onClick={() => handleSelectDataset(dataset)}
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Dataset Card Component
// ============================================================================

type DatasetCardProps = {
  name: string;
  columnCount: number;
  entryCount: number;
  updatedAt: Date;
  onClick: () => void;
};

function DatasetCard({
  name,
  columnCount,
  entryCount,
  updatedAt,
  onClick,
}: DatasetCardProps) {
  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.muted", bg: "blue.subtle" }}
      transition="all 0.15s"
      data-testid={`dataset-card-${name}`}
    >
      <HStack gap={3}>
        <Box color="blue.fg">
          <Database size={20} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {name}
          </Text>
          <HStack gap={2} fontSize="xs" color="fg.muted">
            <Text>{entryCount} entries</Text>
            <Text>•</Text>
            <Text>{columnCount} columns</Text>
            <Text>•</Text>
            <Text>
              Updated{" "}
              {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
