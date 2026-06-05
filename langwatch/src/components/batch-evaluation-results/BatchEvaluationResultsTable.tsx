/**
 * BatchEvaluationResultsTable - Main table component for batch evaluation results
 *
 * This is a wrapper component that renders either:
 * - SingleRunTable: for viewing a single evaluation run
 * - ComparisonTable: for comparing multiple runs side by side
 *
 * The actual table implementations are in separate files for better maintainability.
 */
import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Columns3, Rows3, SlidersHorizontal } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Radio, RadioGroup } from "~/components/ui/radio";
import { ComparisonTable } from "./ComparisonTable";
import { SingleRunTable } from "./SingleRunTable";
import {
  DEFAULT_ROW_HEIGHT,
  ROW_HEIGHT_OPTIONS,
  type RowHeight,
} from "./tableUtils";
import type {
  BatchDatasetColumn,
  BatchEvaluationData,
  ComparisonRunData,
} from "./types";
import type { ResultField } from "./useResultDisplayPreferences";

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
  /** Whether to render target output values (default true) */
  showOutputs?: boolean;
  /** Whether to render evaluator score chips (default true) */
  showEvaluations?: boolean;
  /** Whether to render the cost/latency readout (default true) */
  showCostAndLatency?: boolean;
  /** How much of each cell's collapsed content to show (default "m") */
  rowHeight?: RowHeight;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
  /** Group rows by this dataset-entry metadata key (comparison mode). */
  groupBy?: string | null;
  /** Called when the user changes the grouping key. */
  onGroupByChange?: (key: string | null) => void;
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

const FIELD_LABELS: Record<ResultField, string> = {
  outputs: "Outputs",
  scores: "Scores",
  costAndLatency: "Latency and cost",
};

const FieldToggle = ({
  field,
  checked,
  onToggle,
}: {
  field: ResultField;
  checked: boolean;
  onToggle: (field: ResultField) => void;
}) => (
  <HStack paddingY={1}>
    <Checkbox checked={checked} onCheckedChange={() => onToggle(field)}>
      <Text fontSize="sm">{FIELD_LABELS[field]}</Text>
    </Checkbox>
  </HStack>
);

/**
 * Fields control — independent checkboxes for which target details render.
 * The trigger label is always "Fields": it never mutates to reflect the
 * current selection, so there's no state it can't name (unlike a preset
 * button whose label degrades to a generic fallback once the selection
 * doesn't match any preset). Exported for use in the page header.
 */
export type FieldsButtonProps = {
  fields: Record<ResultField, boolean>;
  onToggle: (field: ResultField) => void;
};

export const FieldsButton = ({ fields, onToggle }: FieldsButtonProps) => (
  <PopoverRoot>
    <PopoverTrigger asChild>
      <Button size="sm" variant="outline" aria-label="Choose result fields">
        <SlidersHorizontal size={16} />
        Fields
      </Button>
    </PopoverTrigger>
    <PopoverContent width="200px">
      <PopoverArrow />
      <PopoverBody>
        {(Object.keys(FIELD_LABELS) as ResultField[]).map((field) => (
          <FieldToggle
            key={field}
            field={field}
            checked={fields[field]}
            onToggle={onToggle}
          />
        ))}
      </PopoverBody>
    </PopoverContent>
  </PopoverRoot>
);

/**
 * Row height control — how much of each cell's content shows before it
 * needs expanding. Unlike field visibility, nothing is hidden here, only
 * resized, so it's safe (and useful) to persist across sessions — see
 * {@link useResultDisplayPreferences}.
 */
export type RowHeightButtonProps = {
  value: RowHeight;
  onChange: (value: RowHeight) => void;
};

export const RowHeightButton = ({ value, onChange }: RowHeightButtonProps) => (
  <PopoverRoot>
    <PopoverTrigger asChild>
      <Button size="sm" variant="outline" aria-label="Change row height">
        <Rows3 size={16} />
        Row height
      </Button>
    </PopoverTrigger>
    <PopoverContent width="160px">
      <PopoverArrow />
      <PopoverBody>
        <RadioGroup
          value={value}
          onValueChange={(d: { value: string | null }) => {
            if (d.value) onChange(d.value as RowHeight);
          }}
          size="sm"
        >
          <VStack align="stretch" gap={1.5}>
            {ROW_HEIGHT_OPTIONS.map((option) => (
              <Radio key={option.value} value={option.value}>
                <Text fontSize="sm">{option.label}</Text>
              </Radio>
            ))}
          </VStack>
        </RadioGroup>
      </PopoverBody>
    </PopoverContent>
  </PopoverRoot>
);

/**
 * Main table component that chooses between single run and comparison modes
 */
export function BatchEvaluationResultsTable({
  data,
  isLoading,
  hiddenColumns = new Set(),
  comparisonData,
  targetColors = {},
  showOutputs = true,
  showEvaluations = true,
  showCostAndLatency = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  disableVirtualization = false,
  groupBy,
  onGroupByChange,
}: BatchEvaluationResultsTableProps) {
  // Determine if we're in comparison mode
  const isComparisonMode = !!comparisonData && comparisonData.length > 1;

  if (isComparisonMode) {
    return (
      <ComparisonTable
        comparisonData={comparisonData}
        isLoading={isLoading}
        hiddenColumns={hiddenColumns}
        showOutputs={showOutputs}
        showEvaluations={showEvaluations}
        showCostAndLatency={showCostAndLatency}
        rowHeight={rowHeight}
        disableVirtualization={disableVirtualization}
        groupBy={groupBy}
        onGroupByChange={onGroupByChange}
      />
    );
  }

  return (
    <SingleRunTable
      data={data}
      isLoading={isLoading}
      hiddenColumns={hiddenColumns}
      targetColors={targetColors}
      showOutputs={showOutputs}
      showEvaluations={showEvaluations}
      showCostAndLatency={showCostAndLatency}
      rowHeight={rowHeight}
      disableVirtualization={disableVirtualization}
    />
  );
}
