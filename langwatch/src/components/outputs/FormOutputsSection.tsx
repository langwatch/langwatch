import { useCallback } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigOutputType } from "~/types";
import { type Output, OutputsSection, type OutputType } from "./OutputsSection";

// Type for the json_schema as expected by the form schema
type JsonSchemaType = { type: string } & Record<string, unknown>;

// ============================================================================
// Types
// ============================================================================

type FormOutputsSectionProps = {
  /** Section title (defaults to "Outputs") */
  title?: string;
  /** Whether in read-only mode */
  readOnly?: boolean;
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Form-connected wrapper around OutputsSection.
 *
 * This component bridges the new OutputsSection UI with react-hook-form,
 * allowing it to be used as a drop-in replacement for OutputsFieldGroup
 * in places that already use FormProvider.
 *
 * Usage:
 * ```tsx
 * <FormProvider {...methods}>
 *   <FormOutputsSection />
 * </FormProvider>
 * ```
 */
export const FormOutputsSection = ({
  title = "Outputs",
  readOnly = false,
}: FormOutputsSectionProps) => {
  const { control, getValues } = useFormContext<PromptConfigFormValues>();

  const fieldArrayName = "version.configData.outputs" as const;

  const { append, remove, update } = useFieldArray({
    control,
    name: fieldArrayName,
  });

  // Use useWatch for reactivity - this ensures we re-render when outputs change
  const watchedOutputs = useWatch({
    control,
    name: fieldArrayName,
  });

  // Convert watched outputs to Output[] for OutputsSection
  const outputs: Output[] = (watchedOutputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
    json_schema: output.json_schema,
  }));

  // Handle outputs change from OutputsSection
  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      // Sync back to form
      const currentFields = getValues(fieldArrayName);

      // If length changed, handle add/remove
      if (newOutputs.length > currentFields.length) {
        // Added an output
        const newOutput = newOutputs[newOutputs.length - 1];
        if (newOutput) {
          append({
            identifier: newOutput.identifier,
            type: newOutput.type as LlmConfigOutputType,
            json_schema: newOutput.json_schema as JsonSchemaType | undefined,
          });
        }
      } else if (newOutputs.length < currentFields.length) {
        // Removed an output - find which one
        for (let i = 0; i < currentFields.length; i++) {
          const currentField = currentFields[i];
          if (
            !newOutputs.some((o) => o.identifier === currentField?.identifier)
          ) {
            remove(i);
            break;
          }
        }
      } else {
        // Same length - check for updates
        for (let i = 0; i < newOutputs.length; i++) {
          const newOutput = newOutputs[i];
          const currentField = currentFields[i];
          if (
            newOutput &&
            currentField &&
            (newOutput.identifier !== currentField.identifier ||
              newOutput.type !== currentField.type ||
              JSON.stringify(newOutput.json_schema) !==
                JSON.stringify(currentField.json_schema))
          ) {
            update(i, {
              identifier: newOutput.identifier,
              type: newOutput.type as LlmConfigOutputType,
              json_schema: newOutput.json_schema as JsonSchemaType | undefined,
            });
          }
        }
      }
    },
    [getValues, append, remove, update],
  );

  return (
    <OutputsSection
      outputs={outputs}
      onChange={handleOutputsChange}
      canAddRemove={!readOnly}
      readOnly={readOnly}
      title={title}
    />
  );
};
