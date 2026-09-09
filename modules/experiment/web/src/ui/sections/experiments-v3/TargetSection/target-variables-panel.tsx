/**
 * A target's input variables and where each one reads its value from.
 *
 * Sources are scoped to the ACTIVE dataset — mappings are stored per dataset —
 * plus the outputs of the other targets, which is how one target chains into
 * another. Only inputs the prompt actually uses count as missing when unmapped:
 * a variable declared and never referenced needs no source.
 *
 * Spec: specs/experiments-v3/mapping-validation.feature
 */

import { Text, VStack } from "@chakra-ui/react";
import type { Field } from "@langwatch/workflow-contract";
import {
  VariablesSection,
  type FieldMapping as VariableFieldMapping,
  type Variable,
} from "@langwatch/prompt-web/surfaces/variables";
import { useMemo } from "react";

import { useResolveTargetName } from "../../../../behavior/experiments-v3/use-resolve-target-name.ts";
import { getUsedFields } from "../../../../model/experiments-v3/mapping-validation.ts";
import { buildTargetAvailableSources } from "../../../../behavior/experiments-v3/target-available-sources.ts";
import type {
  DatasetReference,
  FieldMapping,
  TargetConfig,
} from "../../../../model/experiments-v3/types.ts";

interface TargetVariablesPanelProps {
  target: TargetConfig;
  /** Mappings are stored per dataset, so the sources follow the active one. */
  activeDatasetId: string;
  datasets: DatasetReference[];
  /** Targets whose outputs this one can read. */
  otherTargets: TargetConfig[];
  onInputsChange: (inputs: Field[]) => void;
  onMappingChange: (inputField: string, mapping: FieldMapping | undefined) => void;
  /** Agents with fixed inputs render the panel without its editing affordances. */
  readOnly?: boolean;
}

function toVariableMappings(
  mappings: Record<string, FieldMapping>,
): Record<string, VariableFieldMapping> {
  const result: Record<string, VariableFieldMapping> = {};
  for (const [key, mapping] of Object.entries(mappings)) {
    result[key] =
      mapping.type === "value"
        ? { type: "value", value: mapping.value }
        : { type: "source", sourceId: mapping.sourceId, path: [mapping.sourceField] };
  }
  return result;
}

function toTargetMapping(
  mapping: VariableFieldMapping,
  datasets: DatasetReference[],
): FieldMapping {
  if (mapping.type === "value") return { type: "value", value: mapping.value };

  return {
    type: "source",
    source: datasets.some((dataset) => dataset.id === mapping.sourceId) ? "dataset" : "target",
    sourceId: mapping.sourceId,
    sourceField: mapping.path.join("."),
  };
}

export function TargetVariablesPanel({
  target,
  activeDatasetId,
  datasets,
  otherTargets,
  onInputsChange,
  onMappingChange,
  readOnly = false,
}: TargetVariablesPanelProps) {
  const resolveTargetName = useResolveTargetName();

  const availableSources = useMemo(
    () =>
      buildTargetAvailableSources({
        activeDataset: datasets.find((dataset) => dataset.id === activeDatasetId),
        otherTargets,
        resolveTargetName,
      }),
    [datasets, activeDatasetId, otherTargets, resolveTargetName],
  );

  const variables = useMemo<Variable[]>(
    () => target.inputs.map((input) => ({ identifier: input.identifier, type: input.type })),
    [target.inputs],
  );

  const datasetMappings = target.mappings[activeDatasetId] ?? {};
  const mappings = useMemo(() => toVariableMappings(datasetMappings), [datasetMappings]);

  const usedFields = useMemo(() => getUsedFields(target), [target]);

  // Only a field the prompt reads AND declares needs a source: a variable used
  // but never declared is an undefined variable, reported elsewhere.
  const missingMappingIds = useMemo(
    () =>
      new Set(
        target.inputs
          .filter((input) => usedFields.has(input.identifier) && !datasetMappings[input.identifier])
          .map((input) => input.identifier),
      ),
    [target.inputs, datasetMappings, usedFields],
  );

  return (
    <VStack align="stretch" gap={4}>
      <VariablesSection
        variables={variables}
        onChange={(next: Variable[]) =>
          onInputsChange(
            next.map((variable) => ({
              identifier: variable.identifier,
              type: variable.type as Field["type"],
            })),
          )
        }
        mappings={mappings}
        onMappingChange={(identifier: string, mapping: VariableFieldMapping | undefined) =>
          onMappingChange(identifier, mapping ? toTargetMapping(mapping, datasets) : undefined)
        }
        availableSources={availableSources}
        showMappings
        canAddRemove={!readOnly}
        readOnly={readOnly}
        title="Input Variables"
        missingMappingIds={missingMappingIds}
        showMissingMappingsError={!readOnly}
      />

      {!readOnly && (
        <Text fontSize="xs" color="fg.muted">
          Connect each input variable to a data source. Use the dropdown to map to dataset columns
          or outputs from other targets.
        </Text>
      )}
    </VStack>
  );
}
