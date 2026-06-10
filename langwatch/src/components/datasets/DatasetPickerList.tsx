/**
 * Searchable list of the project's datasets — the picker experience shared
 * by the Choose Dataset drawer (evaluations workbench) and the workflow
 * dataset node. Renders search, loading, empty states, and one card per
 * dataset with entry/column counts and last-edit date.
 */
import { Box, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { Database, Search } from "react-feather";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DatasetColumns } from "~/server/datasets/types";
import { api } from "~/utils/api";

export type DatasetPickerSelection = {
  datasetId: string;
  name: string;
  columnTypes: DatasetColumns;
};

export function DatasetPickerList({
  enabled = true,
  onSelect,
}: {
  /** Gate the datasets query (e.g. only when the hosting dialog is open). */
  enabled?: boolean;
  onSelect: (dataset: DatasetPickerSelection) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const [searchQuery, setSearchQuery] = useState("");

  const datasetsQuery = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && enabled },
  );

  const filteredDatasets = useMemo(() => {
    if (!datasetsQuery.data) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) return datasetsQuery.data;
    return datasetsQuery.data.filter((dataset) =>
      dataset.name.toLowerCase().includes(query),
    );
  }, [datasetsQuery.data, searchQuery]);

  return (
    <VStack gap={4} align="stretch" flex={1} overflow="hidden" width="full">
      <Box position="relative">
        <Box
          position="absolute"
          left={3}
          top="50%"
          transform="translateY(-50%)"
          color="fg.subtle"
          zIndex={1}
        >
          <Search size={16} />
        </Box>
        <Input
          placeholder="Search datasets..."
          data-testid="dataset-picker-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          paddingLeft={10}
        />
      </Box>

      <VStack gap={2} align="stretch" flex={1} overflowY="auto">
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
              entryCount={
                dataset.useS3
                  ? (dataset.s3RecordCount ?? 0)
                  : dataset._count.datasetRecords
              }
              updatedAt={dataset.updatedAt}
              onClick={() =>
                onSelect({
                  datasetId: dataset.id,
                  name: dataset.name,
                  columnTypes: dataset.columnTypes as DatasetColumns,
                })
              }
            />
          ))
        )}
      </VStack>
    </VStack>
  );
}

function DatasetCard({
  name,
  columnCount,
  entryCount,
  updatedAt,
  onClick,
}: {
  name: string;
  columnCount: number;
  entryCount: number;
  updatedAt: Date;
  onClick: () => void;
}) {
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
