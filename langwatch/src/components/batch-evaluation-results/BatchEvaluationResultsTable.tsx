/**
 * BatchEvaluationResultsTable - Main table component for batch evaluation results
 *
 * This is a wrapper component that renders either:
 * - SingleRunTable: for viewing a single evaluation run
 * - ComparisonTable: for comparing multiple runs side by side
 *
 * The actual table implementations are in separate files for better maintainability.
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Columns3, Eye } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ComparisonTable } from "./ComparisonTable";
import { SingleRunTable } from "./SingleRunTable";
import type {
  BatchDatasetColumn,
  BatchEvaluationData,
  ComparisonRunData,
} from "./types";

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
 * Which result sections the table renders. Lets users dial the detail level
 * up or down — e.g. read outputs without the evaluator-score noise, or scan
 * scores without the outputs. Dataset columns stay controlled by
 * {@link ColumnVisibilityButton}.
 */
export type ViewSections = {
  /** Show the target/model output values */
  outputs: boolean;
  /** Show the evaluator score chips */
  evaluations: boolean;
};

export const DEFAULT_VIEW_SECTIONS: ViewSections = {
  outputs: true,
  evaluations: true,
};

/** Quick "lenses" that map to common section combinations. */
const VIEW_PRESETS: { id: string; label: string; sections: ViewSections }[] = [
  { id: "all", label: "Everything", sections: { outputs: true, evaluations: true } },
  { id: "data", label: "Data only", sections: { outputs: true, evaluations: false } },
  { id: "scores", label: "Scores only", sections: { outputs: false, evaluations: true } },
];

/**
 * View lens control — quick presets plus per-section toggles for tuning how
 * much detail the results table shows. Exported for use in the page header.
 */
export type ViewLensButtonProps = {
  sections: ViewSections;
  onChange: (sections: ViewSections) => void;
};

export const ViewLensButton = ({ sections, onChange }: ViewLensButtonProps) => {
  const activePreset = VIEW_PRESETS.find(
    (preset) =>
      preset.sections.outputs === sections.outputs &&
      preset.sections.evaluations === sections.evaluations,
  );

  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" aria-label="Change results view">
          <Eye size={16} />
          {activePreset?.label ?? "View"}
        </Button>
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverArrow />
        <PopoverBody>
          <VStack align="stretch" gap={2}>
            <Text fontSize="xs" color="fg.muted" fontWeight="medium">
              Quick views
            </Text>
            <HStack gap={1} flexWrap="wrap">
              {VIEW_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  size="xs"
                  variant={activePreset?.id === preset.id ? "solid" : "outline"}
                  onClick={() => onChange(preset.sections)}
                >
                  {preset.label}
                </Button>
              ))}
            </HStack>
            <Box borderTopWidth="1px" borderColor="border" marginY={1} />
            <Text fontSize="xs" color="fg.muted" fontWeight="medium">
              Sections
            </Text>
            <HStack paddingY={1}>
              <Checkbox
                checked={sections.outputs}
                onCheckedChange={() =>
                  onChange({ ...sections, outputs: !sections.outputs })
                }
              >
                <Text fontSize="sm">Outputs</Text>
              </Checkbox>
            </HStack>
            <HStack paddingY={1}>
              <Checkbox
                checked={sections.evaluations}
                onCheckedChange={() =>
                  onChange({ ...sections, evaluations: !sections.evaluations })
                }
              >
                <Text fontSize="sm">Evaluations</Text>
              </Checkbox>
            </HStack>
          </VStack>
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
  showOutputs = true,
  showEvaluations = true,
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
        showOutputs={showOutputs}
        showEvaluations={showEvaluations}
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
      showOutputs={showOutputs}
      showEvaluations={showEvaluations}
      disableVirtualization={disableVirtualization}
    />
  );
}
