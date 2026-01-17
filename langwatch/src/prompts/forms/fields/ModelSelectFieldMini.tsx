import { Button } from "@chakra-ui/react";
import React, { useCallback } from "react";
import { ChevronDown } from "react-feather";
import {
  Controller,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form";
import {
  LLMConfigPopover,
  type Output,
  type OutputType,
} from "~/components/llmPromptConfigs/LLMConfigPopover";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { Popover } from "~/components/ui/popover";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigOutputType } from "~/types";

type ModelSelectFieldMiniProps = {
  /** Whether to show the structured outputs section in the config popover */
  showStructuredOutputs?: boolean;
};

/**
 * Model Select Field Mini
 *
 * Single Responsibility: Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration popover on click.
 *
 * Can be used within a FormProvider context (uses react-hook-form Controller)
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini({
  showStructuredOutputs = true,
}: ModelSelectFieldMiniProps) {
  const { control, formState, trigger, getValues } =
    useFormContext<PromptConfigFormValues>();

  // Outputs field array for structured outputs
  const outputsFieldArray = useFieldArray({
    control,
    name: "version.configData.outputs",
  });

  // Watch outputs for the popover
  const watchedOutputs = useWatch({
    control,
    name: "version.configData.outputs",
  });

  // Convert watched outputs to Output[] for LLMConfigPopover
  const outputs: Output[] = (watchedOutputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
    json_schema: output.json_schema,
  }));

  // Handle outputs change from LLMConfigPopover
  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      const currentFields = getValues("version.configData.outputs");
      const lengthDiff = newOutputs.length - currentFields.length;

      // If removing multiple outputs at once (e.g., disabling structured outputs),
      // replace the entire array
      if (lengthDiff < -1 || (lengthDiff === -1 && newOutputs.length === 1)) {
        // Replace all outputs - use replace method for efficiency
        outputsFieldArray.replace(
          newOutputs.map((o) => ({
            identifier: o.identifier,
            type: o.type as LlmConfigOutputType,
            json_schema: o.json_schema as { type: string } | undefined,
          })),
        );
        return;
      }

      // If length changed, handle add/remove
      if (newOutputs.length > currentFields.length) {
        // Added an output
        const newOutput = newOutputs[newOutputs.length - 1];
        if (newOutput) {
          outputsFieldArray.append({
            identifier: newOutput.identifier,
            type: newOutput.type as LlmConfigOutputType,
            json_schema: newOutput.json_schema as { type: string } | undefined,
          });
        }
      } else if (newOutputs.length < currentFields.length) {
        // Removed a single output - find which one
        for (let i = 0; i < currentFields.length; i++) {
          const currentField = currentFields[i];
          if (
            !newOutputs.some((o) => o.identifier === currentField?.identifier)
          ) {
            outputsFieldArray.remove(i);
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
            outputsFieldArray.update(i, {
              identifier: newOutput.identifier,
              type: newOutput.type as LlmConfigOutputType,
              json_schema: newOutput.json_schema as
                | { type: string }
                | undefined,
            });
          }
        }
      }
    },
    [getValues, outputsFieldArray],
  );

  return (
    <Controller
      key="version.configData.llm"
      name="version.configData.llm"
      control={control}
      render={({ field }) => {
        const llmErrors = formState.errors.version?.configData?.llm;
        return (
          <Popover.Root positioning={{ placement: "bottom" }}>
            <Popover.Trigger asChild>
              <Button
                variant="outline"
                fontWeight="normal"
                _active={{ bg: "gray.50" }}
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <ChevronDown size={16} />
              </Button>
            </Popover.Trigger>
            <LLMConfigPopover
              values={field.value}
              onChange={(values) => {
                field.onChange(values);
                void trigger?.("version.configData.llm");
              }}
              errors={llmErrors}
              outputs={outputs}
              onOutputsChange={handleOutputsChange}
              showStructuredOutputs={showStructuredOutputs}
            />
          </Popover.Root>
        );
      }}
    />
  );
});
