/**
 * BatchEvaluationResultsTable - Main table component for batch evaluation results
 *
 * This is a wrapper component that renders either:
 * - SingleRunTable: for viewing a single evaluation run
 * - ComparisonTable: for comparing multiple runs side by side
 *
 * The actual table implementations are in separate files for better maintainability.
 */
import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Columns3 } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";

import type {
  BatchEvaluationData,
  BatchDatasetColumn,
  ComparisonRunData,
} from "./types";
import { SingleRunTable } from "./SingleRunTable";
import { ComparisonTable } from "./ComparisonTable";

type BatchEvaluationResultsTableProps = {
  /** Transformed batch evaluation data (single run mode) */
  data: BatchEvaluationData | null;
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names (controlled from parent) */
  hiddenColumns?: Set<string>;
  /** Callback when column visibility changes */
  onToggleColumn?: (columnName: string) => void;
  /** Comparison mode: multiple runs to display side by side */
  comparisonData?: ComparisonRunData[] | null;
  /** Target colors for when X-axis is "target" in charts */
  targetColors?: Record<string, string>;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
};

/**
 * Columns that should be hidden by default
 * Typically metadata columns like "id" that users rarely need to see
 */
export const DEFAULT_HIDDEN_COLUMNS = new Set(["id", "_id", "ID", "Id"]);

/**
 * Column visibility toggle button with popover menu
 * Exported for use in page header
 */
export type ColumnVisibilityButtonProps = {
  datasetColumns: BatchDatasetColumn[];
  hiddenColumns: Set<string>;
  onToggle: (columnName: string) => void;
};

export const ColumnVisibilityButton = ({
  datasetColumns,
  hiddenColumns,
  onToggle,
}: ColumnVisibilityButtonProps) => {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label="Toggle column visibility"
        >
          <Columns3 size={16} />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent width="200px">
        <PopoverArrow />
        <PopoverBody>
          {datasetColumns.map((col) => (
            <HStack key={col.name} paddingY={1}>
              <Checkbox
                checked={!hiddenColumns.has(col.name)}
                onCheckedChange={() => onToggle(col.name)}
              >
                <Text fontSize="sm">{col.name}</Text>
              </Checkbox>
            </HStack>
          ))}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

/**
 * Main table component that chooses between single run and comparison modes
 */
export function BatchEvaluationResultsTable({
  data,
  isLoading,
  hiddenColumns = new Set(),
  comparisonData,
  targetColors = {},
  disableVirtualization = false,
}: BatchEvaluationResultsTableProps) {
  // Determine if we're in comparison mode
  const isComparisonMode = !!comparisonData && comparisonData.length > 1;

  if (isComparisonMode) {
    return (
      <ComparisonTable
        comparisonData={comparisonData}
        isLoading={isLoading}
        hiddenColumns={hiddenColumns}
        disableVirtualization={disableVirtualization}
      />
    );
  }

  return (
    <SingleRunTable
      data={data}
      isLoading={isLoading}
      hiddenColumns={hiddenColumns}
      targetColors={targetColors}
      disableVirtualization={disableVirtualization}
    />
  );
}
