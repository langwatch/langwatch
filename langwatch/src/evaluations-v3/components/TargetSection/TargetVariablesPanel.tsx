import { Box, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  type AvailableSource,
  datasetColumnTypeToFieldType,
  type FieldType,
  type Variable,
  type FieldMapping as VariableFieldMapping,
  VariablesSection,
} from "~/components/variables";
import type { Field } from "~/optimization_studio/types/dsl";
import type { DatasetReference, FieldMapping, TargetConfig } from "../../types";
import { getUsedFields } from "../../utils/mappingValidation";

// ============================================================================
// Types
// ============================================================================

type TargetVariablesPanelProps = {
  /** The target being configured */
  target: TargetConfig;
  /** The currently active dataset ID (mappings are stored per-dataset) */
  activeDatasetId: string;
  /** All datasets in the workbench (for mapping sources) */
  datasets: DatasetReference[];
  /** Other targets that can be sources (for chaining outputs) */
  otherTargets: TargetConfig[];
  /** Callback when inputs change */
  onInputsChange: (inputs: Field[]) => void;
  /** Callback when a single mapping changes for the active dataset */
  onMappingChange: (
    inputField: string,
    mapping: FieldMapping | undefined,
  ) => void;
  /** Whether the inputs are read-only (e.g., for agents with fixed inputs) */
  readOnly?: boolean;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert the active dataset and targets to AvailableSource format for the VariablesSection.
 * Only the active dataset is included as a source - sources are scoped per-dataset.
 */
const buildAvailableSources = (
  activeDataset: DatasetReference | undefined,
  otherTargets: TargetConfig[],
): AvailableSource[] => {
  const sources: AvailableSource[] = [];

  // Add only the active dataset as a source
  if (activeDataset) {
    sources.push({
      id: activeDataset.id,
      name: activeDataset.name,
      type: "dataset",
      fields: activeDataset.columns.map((col) => ({
        name: col.name,
        // Convert DatasetColumnType to FieldType
        type: datasetColumnTypeToFieldType(col.type),
      })),
    });
  }

  // Add other targets as sources (their outputs can be inputs to this target)
  for (const target of otherTargets) {
    const sourceType = target.type === "prompt" ? "signature" : "code";
    sources.push({
      id: target.id,
      name: target.name,
      type: sourceType,
      fields: target.outputs.map((output) => ({
        name: output.identifier,
        // Target outputs already use FieldType
        type: output.type as FieldType,
      })),
    });
  }

  return sources;
};

/**
 * Convert Field[] to Variable[] for the VariablesSection.
 */
const fieldsToVariables = (fields: Field[]): Variable[] => {
  return fields.map((field) => ({
    identifier: field.identifier,
    type: field.type,
  }));
};

/**
 * Convert Variable[] back to Field[] for storage.
 */
const variablesToFields = (variables: Variable[]): Field[] => {
  return variables.map((variable) => ({
    identifier: variable.identifier,
    type: variable.type as Field["type"],
  }));
};

/**
 * Convert TargetConfig mappings to VariablesSection format.
 * Both support source and value mapping types.
 */
const convertToVariableMappings = (
  mappings: Record<string, FieldMapping>,
): Record<string, VariableFieldMapping> => {
  const result: Record<string, VariableFieldMapping> = {};

  for (const [key, mapping] of Object.entries(mappings)) {
    if (mapping.type === "value") {
      result[key] = { type: "value", value: mapping.value };
    } else {
      result[key] = {
        type: "source",
        sourceId: mapping.sourceId,
        field: mapping.sourceField,
      };
    }
  }

  return result;
};

/**
 * Convert VariablesSection mapping back to TargetConfig format.
 * For source mappings, determines if source is a dataset or target.
 */
const convertFromVariableMapping = (
  mapping: VariableFieldMapping,
  datasets: DatasetReference[],
): FieldMapping => {
  if (mapping.type === "value") {
    return { type: "value", value: mapping.value };
  }

  // Source mapping - check if sourceId is a dataset
  const isDataset = datasets.some((d) => d.id === mapping.sourceId);

  return {
    type: "source",
    source: isDataset ? "dataset" : "target",
    sourceId: mapping.sourceId,
    sourceField: mapping.field,
  };
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Panel for configuring target input variables and their mappings.
 *
 * Features:
 * - Shows list of input variables with type icons
 * - Each variable has a mapping dropdown to connect to dataset columns or other target outputs
 * - Can add/remove/rename variables (unless readOnly)
 * - Indicates when required mappings are missing
 */
export const TargetVariablesPanel = ({
  target,
  activeDatasetId,
  datasets,
  otherTargets,
  onInputsChange,
  onMappingChange,
  readOnly = false,
}: TargetVariablesPanelProps) => {
  // Find the active dataset
  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId),
    [datasets, activeDatasetId],
  );

  // Build available sources for mapping (only active dataset)
  const availableSources = useMemo(
    () => buildAvailableSources(activeDataset, otherTargets),
    [activeDataset, otherTargets],
  );

  // Convert target inputs to variables
  const variables = useMemo(
    () => fieldsToVariables(target.inputs),
    [target.inputs],
  );

  // Get mappings for the active dataset
  const datasetMappings = target.mappings[activeDatasetId] ?? {};

  // Convert target mappings to variable mappings for display
  const mappings = useMemo(
    () => convertToVariableMappings(datasetMappings),
    [datasetMappings],
  );

  // Get fields that are actually used in the prompt (for validation)
  const usedFields = useMemo(() => getUsedFields(target), [target]);

  // Check for missing mappings for the active dataset
  // Only check fields that are BOTH used in the prompt AND in the inputs list
  // "Undefined variables" (used but not in inputs) don't require mappings
  const missingMappings = useMemo(() => {
    return target.inputs.filter(
      (input) =>
        usedFields.has(input.identifier) && !datasetMappings[input.identifier],
    );
  }, [target.inputs, datasetMappings, usedFields]);

  // Create a set of missing mapping identifiers for highlighting
  const missingMappingIds = useMemo(() => {
    return new Set(missingMappings.map((m) => m.identifier));
  }, [missingMappings]);

  // Handle variables change
  const handleVariablesChange = (newVariables: Variable[]) => {
    const newFields = variablesToFields(newVariables);
    onInputsChange(newFields);
  };

  // Handle mapping change for a single field
  const handleMappingChange = (
    identifier: string,
    mapping: VariableFieldMapping | undefined,
  ) => {
    if (mapping) {
      const storeMapping = convertFromVariableMapping(mapping, datasets);
      onMappingChange(identifier, storeMapping);
    } else {
      onMappingChange(identifier, undefined);
    }
  };

  return (
    <VStack align="stretch" gap={4}>
      {/* Warning for missing mappings */}
      {missingMappings.length > 0 && !readOnly && (
        <Box
          background="orange.50"
          border="1px solid"
          borderColor="orange.200"
          borderRadius="md"
          padding={3}
        >
          <Text fontSize="sm" color="orange.800">
            ⚠️ {missingMappings.length} input
            {missingMappings.length === 1 ? "" : "s"} not mapped:{" "}
            {missingMappings.map((m) => m.identifier).join(", ")}
          </Text>
        </Box>
      )}

      {/* Variables section with mappings */}
      <VariablesSection
        variables={variables}
        onChange={handleVariablesChange}
        mappings={mappings}
        onMappingChange={handleMappingChange}
        availableSources={availableSources}
        showMappings={true}
        canAddRemove={!readOnly}
        readOnly={readOnly}
        title="Input Variables"
        missingMappingIds={missingMappingIds}
      />

      {/* Helper text */}
      {!readOnly && (
        <Text fontSize="xs" color="gray.500">
          Connect each input variable to a data source. Use the dropdown to map
          to dataset columns or outputs from other targets.
        </Text>
      )}
    </VStack>
  );
};
