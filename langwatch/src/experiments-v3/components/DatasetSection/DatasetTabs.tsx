import {
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { generate } from "@langwatch/ksuid";
import {
  ChevronDown,
  Database,
  Download,
  Edit2,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo } from "react";

import { Menu } from "~/components/ui/menu";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { DatasetColumn, DatasetReference } from "../../types";
import { DEFAULT_TEST_DATA_ID } from "../../types";

type DatasetTabsProps = {
  onSelectExisting: () => void;
  onUploadCSV: () => void;
  onEditDataset: () => void;
  onSaveAsDataset: (dataset: DatasetReference) => void;
};

/**
 * Dataset tabs component for switching between multiple datasets.
 * - Clicking a tab switches to that dataset
 * - Dropdown menu only appears on the active/selected tab
 * - Shows "Datasets" label with database icon
 */
export function DatasetTabs({
  onSelectExisting,
  onUploadCSV,
  onEditDataset,
  onSaveAsDataset,
}: DatasetTabsProps) {
  const {
    datasets,
    activeDatasetId,
    setActiveDataset,
    addDataset,
    removeDataset,
  } = useEvaluationsV3Store((state) => ({
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId,
    setActiveDataset: state.setActiveDataset,
    addDataset: state.addDataset,
    removeDataset: state.removeDataset,
  }));

  // Get first dataset's columns to copy structure for new datasets
  const firstDatasetColumns = useMemo(() => {
    const first = datasets[0];
    if (!first) {
      return [
        { id: "input", name: "input", type: "string" as const },
        {
          id: "expected_output",
          name: "expected_output",
          type: "string" as const,
        },
      ];
    }
    return first.columns;
  }, [datasets]);

  const handleAddNewDataset = () => {
    const newId = generate("dataset").toString();
    // Copy column structure from first dataset
    const columns = firstDatasetColumns.map((col) => ({ ...col }));
    const records: Record<string, string[]> = {};
    for (const col of columns) {
      records[col.id] = ["", "", ""];
    }

    const newDataset: DatasetReference = {
      id: newId,
      name: `Dataset ${datasets.length + 1}`,
      type: "inline",
      inline: {
        columns,
        records,
      },
      columns,
    };
    addDataset(newDataset);
    setActiveDataset(newId);
  };

  const handleRemoveDataset = (datasetId: string) => {
    if (datasets.length <= 1) return;
    removeDataset(datasetId);
  };

  return (
    <HStack
      gap={2}
      flexWrap="nowrap"
      alignItems="center"
      overflow="auto"
      width="full"
    >
      <Text fontWeight="semibold" fontSize="sm" color="fg" paddingRight={2}>
        Datasets
      </Text>

      {/* Dataset tabs */}
      {datasets.map((dataset) => (
        <DatasetTab
          key={dataset.id}
          dataset={dataset}
          isActive={dataset.id === activeDatasetId}
          onSelect={() => setActiveDataset(dataset.id)}
          onRemove={() => handleRemoveDataset(dataset.id)}
          onSaveAs={() => onSaveAsDataset(dataset)}
          canRemove={datasets.length > 1}
        />
      ))}

      {/* Add dataset button */}
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <IconButton
            aria-label="Add dataset"
            size="xs"
            variant="ghost"
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.subtle" }}
          >
            <Plus size={14} />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content minWidth="200px">
          <Menu.Item value="select" onClick={onSelectExisting}>
            <HStack gap={2}>
              <Database size={14} />
              <Text>Select existing dataset</Text>
            </HStack>
          </Menu.Item>
          <Menu.Item value="upload" onClick={onUploadCSV}>
            <HStack gap={2}>
              <Upload size={14} />
              <Text>Upload CSV</Text>
            </HStack>
          </Menu.Item>
          <Menu.Item value="new" onClick={handleAddNewDataset}>
            <HStack gap={2}>
              <Plus size={14} />
              <Text>Create new</Text>
            </HStack>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Spacer />

      {/* Edit current dataset button */}
      <IconButton
        aria-label="Edit dataset columns"
        size="xs"
        variant="ghost"
        color="fg.muted"
        _hover={{ color: "fg", bg: "bg.subtle" }}
        onClick={onEditDataset}
      >
        <Settings2 size={14} />
      </IconButton>
    </HStack>
  );
}

// ============================================================================
// Dataset Tab Component
// ============================================================================

type DatasetTabProps = {
  dataset: DatasetReference;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onSaveAs: () => void;
  canRemove: boolean;
};

function DatasetTab({
  dataset,
  isActive,
  onSelect,
  onRemove,
  onSaveAs,
  canRemove,
}: DatasetTabProps) {
  const isSaved = dataset.type === "saved";

  // If not active, just render a clickable button (no dropdown)
  if (!isActive) {
    return (
      <Button
        size="xs"
        variant="ghost"
        onClick={onSelect}
        paddingX={2}
        paddingY={1}
        height="auto"
        _hover={{ bg: "bg.subtle" }}
        data-testid={`dataset-tab-${dataset.id}`}
      >
        <HStack gap={1}>
          <Database
            size={12}
            color={isSaved ? "var(--chakra-colors-blue-500)" : "currentColor"}
          />
          <Text fontSize="12px" fontWeight="medium">
            {dataset.name}
          </Text>
        </HStack>
      </Button>
    );
  }

  // Active tab has dropdown menu
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          bg="bg.muted"
          borderColor="border.emphasized"
          paddingX={2}
          paddingY={1}
          height="auto"
          _hover={{ bg: "bg.emphasized" }}
          data-testid={`dataset-tab-${dataset.id}`}
        >
          <HStack gap={1}>
            <Database
              size={12}
              color={isSaved ? "var(--chakra-colors-blue-500)" : "currentColor"}
            />
            <Text fontSize="12px" fontWeight="semibold">
              {dataset.name}
            </Text>
            <ChevronDown size={10} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="180px">
        {dataset.type === "inline" && (
          <Menu.Item value="save" onClick={onSaveAs}>
            <HStack gap={2}>
              <Download size={14} />
              <Text>Save as dataset</Text>
            </HStack>
          </Menu.Item>
        )}
        {dataset.type === "inline" && (
          <Box borderTopWidth="1px" borderColor="border" my={1} />
        )}
        <Menu.Item value="remove" onClick={onRemove} disabled={!canRemove}>
          <HStack gap={2}>
            <Trash2 size={14} />
            <Text>Remove from workbench</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
