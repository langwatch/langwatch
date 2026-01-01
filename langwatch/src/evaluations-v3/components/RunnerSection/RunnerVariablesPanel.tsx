import { VStack, Text, Box } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  VariablesSection,
  datasetColumnTypeToFieldType,
  type Variable,
  type AvailableSource,
  type FieldMapping as VariableFieldMapping,
  type FieldType,
} from "~/components/variables";
import type { RunnerConfig, FieldMapping, DatasetReference } from "../../types";
import type { Field } from "~/optimization_studio/types/dsl";

// ============================================================================
// Types
// ============================================================================

type RunnerVariablesPanelProps = {
  /** The runner being configured */
  runner: RunnerConfig;
  /** All datasets in the workbench (for mapping sources) */
  datasets: DatasetReference[];
  /** Other runners that can be sources (for chaining outputs) */
  otherRunners: RunnerConfig[];
  /** Callback when inputs change */
  onInputsChange: (inputs: Field[]) => void;
  /** Callback when mappings change */
  onMappingsChange: (mappings: Record<string, FieldMapping>) => void;
  /** Whether the inputs are read-only (e.g., for agents with fixed inputs) */
  readOnly?: boolean;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert datasets and runners to AvailableSource format for the VariablesSection.
 */
const buildAvailableSources = (
  datasets: DatasetReference[],
  otherRunners: RunnerConfig[]
): AvailableSource[] => {
  const sources: AvailableSource[] = [];

  // Add datasets as sources
  for (const dataset of datasets) {
    sources.push({
      id: dataset.id,
      name: dataset.name,
      type: "dataset",
      fields: dataset.columns.map((col) => ({
        name: col.name,
        // Convert DatasetColumnType to FieldType
        type: datasetColumnTypeToFieldType(col.type),
      })),
    });
  }

  // Add other runners as sources (their outputs can be inputs to this runner)
  for (const runner of otherRunners) {
    const sourceType = runner.type === "prompt" ? "signature" : "code";
    sources.push({
      id: runner.id,
      name: runner.name,
      type: sourceType,
      fields: runner.outputs.map((output) => ({
        name: output.identifier,
        // Runner outputs already use FieldType
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
 * Convert RunnerConfig mappings to VariablesSection format.
 * Both support source and value mapping types.
 */
const convertToVariableMappings = (
  mappings: Record<string, FieldMapping>
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
 * Convert VariablesSection mapping back to RunnerConfig format.
 * For source mappings, determines if source is a dataset or runner.
 */
const convertFromVariableMapping = (
  mapping: VariableFieldMapping,
  datasets: DatasetReference[]
): FieldMapping => {
  if (mapping.type === "value") {
    return { type: "value", value: mapping.value };
  }

  // Source mapping - check if sourceId is a dataset
  const isDataset = datasets.some((d) => d.id === mapping.sourceId);

  return {
    type: "source",
    source: isDataset ? "dataset" : "runner",
    sourceId: mapping.sourceId,
    sourceField: mapping.field,
  };
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Panel for configuring runner input variables and their mappings.
 *
 * Features:
 * - Shows list of input variables with type icons
 * - Each variable has a mapping dropdown to connect to dataset columns or other runner outputs
 * - Can add/remove/rename variables (unless readOnly)
 * - Indicates when required mappings are missing
 */
export const RunnerVariablesPanel = ({
  runner,
  datasets,
  otherRunners,
  onInputsChange,
  onMappingsChange,
  readOnly = false,
}: RunnerVariablesPanelProps) => {
  // Build available sources for mapping
  const availableSources = useMemo(
    () => buildAvailableSources(datasets, otherRunners),
    [datasets, otherRunners]
  );

  // Convert runner inputs to variables
  const variables = useMemo(
    () => fieldsToVariables(runner.inputs),
    [runner.inputs]
  );

  // Convert runner mappings to variable mappings
  const mappings = useMemo(
    () => convertToVariableMappings(runner.mappings),
    [runner.mappings]
  );

  // Check for missing mappings
  const missingMappings = useMemo(() => {
    return runner.inputs.filter((input) => !runner.mappings[input.identifier]);
  }, [runner.inputs, runner.mappings]);

  // Handle variables change
  const handleVariablesChange = (newVariables: Variable[]) => {
    const newFields = variablesToFields(newVariables);
    onInputsChange(newFields);
  };

  // Handle mapping change
  const handleMappingChange = (
    identifier: string,
    mapping: VariableFieldMapping | undefined
  ) => {
    const newMappings = { ...runner.mappings };

    if (mapping) {
      newMappings[identifier] = convertFromVariableMapping(mapping, datasets);
    } else {
      delete newMappings[identifier];
    }

    onMappingsChange(newMappings);
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
      />

      {/* Helper text */}
      {!readOnly && (
        <Text fontSize="xs" color="gray.500">
          Connect each input variable to a data source. Use the dropdown to map
          to dataset columns or outputs from other runners.
        </Text>
      )}
    </VStack>
  );
};
