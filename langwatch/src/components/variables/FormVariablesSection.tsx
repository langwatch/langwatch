import { useCallback } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigInputType } from "~/types";
import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from ".";

// ============================================================================
// Types
// ============================================================================

type FormVariablesSectionProps = {
  /** Section title (defaults to "Variables") */
  title?: string;
  /** Whether to show mapping UI */
  showMappings?: boolean;
  /** Available sources for mapping (only used if showMappings is true) */
  availableSources?: AvailableSource[];
  /** Mappings for each variable */
  mappings?: Record<string, FieldMapping>;
  /** Callback when a mapping changes */
  onMappingChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
  /** Whether in read-only mode */
  readOnly?: boolean;
  /** Set of variable identifiers that are missing required mappings (for highlighting) */
  missingMappingIds?: Set<string>;
  /** Set of variable identifiers that cannot be removed (locked variables) */
  lockedVariables?: Set<string>;
  /** Custom info tooltips for specific variables (identifier -> tooltip text) */
  variableInfo?: Record<string, string>;
  /** Set of variable identifiers whose mapping input is disabled */
  disabledMappings?: Set<string>;
  /** Whether to show the Add button (defaults to true) */
  showAddButton?: boolean;
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Form-connected wrapper around VariablesSection.
 *
 * This component bridges the new VariablesSection UI with react-hook-form,
 * allowing it to be used as a drop-in replacement for InputsFieldGroup
 * in places that already use FormProvider.
 *
 * Usage:
 * ```tsx
 * <FormProvider {...methods}>
 *   <FormVariablesSection />
 * </FormProvider>
 * ```
 */
export const FormVariablesSection = ({
  title = "Variables",
  showMappings = false,
  availableSources = [],
  mappings = {},
  onMappingChange,
  readOnly = false,
  missingMappingIds,
  lockedVariables,
  variableInfo,
  disabledMappings,
  showAddButton = true,
}: FormVariablesSectionProps) => {
  const { control, getValues } = useFormContext<PromptConfigFormValues>();

  const fieldArrayName = "version.configData.inputs" as const;

  const { append, remove, update } = useFieldArray({
    control,
    name: fieldArrayName,
  });

  // Use useWatch for reactivity - this ensures we re-render when inputs change
  // even if they're modified by another useFieldArray instance
  const watchedInputs = useWatch({
    control,
    name: fieldArrayName,
  });

  // Convert watched inputs to Variable[] for VariablesSection
  const variables: Variable[] = (watchedInputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Handle variables change from VariablesSection
  const handleVariablesChange = useCallback(
    (newVariables: Variable[]) => {
      // Sync back to form
      // First, check what changed
      const currentFields = getValues(fieldArrayName);

      // If length changed, handle add/remove
      if (newVariables.length > currentFields.length) {
        // Added a variable
        const newVar = newVariables[newVariables.length - 1];
        if (newVar) {
          append({
            identifier: newVar.identifier,
            type: newVar.type as LlmConfigInputType,
          });
        }
      } else if (newVariables.length < currentFields.length) {
        // Removed a variable - find which one
        for (let i = 0; i < currentFields.length; i++) {
          const currentField = currentFields[i];
          if (
            !newVariables.some((v) => v.identifier === currentField?.identifier)
          ) {
            remove(i);
            break;
          }
        }
      } else {
        // Same length - check for updates
        for (let i = 0; i < newVariables.length; i++) {
          const newVar = newVariables[i];
          const currentField = currentFields[i];
          if (
            newVar &&
            currentField &&
            (newVar.identifier !== currentField.identifier ||
              newVar.type !== currentField.type)
          ) {
            update(i, {
              identifier: newVar.identifier,
              type: newVar.type as LlmConfigInputType,
            });
          }
        }
      }
    },
    [getValues, append, remove, update],
  );

  return (
    <VariablesSection
      variables={variables}
      onChange={handleVariablesChange}
      mappings={mappings}
      onMappingChange={onMappingChange}
      availableSources={availableSources}
      showMappings={showMappings}
      canAddRemove={!readOnly}
      readOnly={readOnly}
      showAddButton={showAddButton}
      title={title}
      missingMappingIds={missingMappingIds}
      lockedVariables={lockedVariables}
      variableInfo={variableInfo}
      disabledMappings={disabledMappings}
    />
  );
};
