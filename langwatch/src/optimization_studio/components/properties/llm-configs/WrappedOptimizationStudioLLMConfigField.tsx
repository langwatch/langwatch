import { VStack } from "@chakra-ui/react";
import { useCallback, useMemo, useRef } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { Output, OutputType } from "~/components/llmPromptConfigs/LLMConfigPopover";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigOutputType } from "~/types";
import { LLMConfigFormatUtils } from "./llm-config-format-utils";
import { OptimizationStudioLLMConfigField } from "./OptimizationStudioLLMConfigField";

/**
 * Wrapped OptimizationStudioLLMConfigField that works with
 * the Form field
 */
export function WrappedOptimizationStudioLLMConfigField() {
  const { control, formState, trigger } =
    useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

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

  // Memoize outputs to prevent unnecessary re-renders of the popover tree
  const outputs: Output[] = useMemo(
    () =>
      (watchedOutputs ?? []).map((output) => ({
        identifier: output.identifier,
        type: output.type as OutputType,
        json_schema: output.json_schema,
      })),
    [watchedOutputs],
  );

  // Stable callback using ref pattern — react-hook-form's useFieldArray returns
  // a new object on every render, which would make handleOutputsChange unstable
  // and cause excessive re-renders of the popover tree
  const outputsFieldArrayRef = useRef(outputsFieldArray);
  outputsFieldArrayRef.current = outputsFieldArray;

  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      outputsFieldArrayRef.current.replace(
        newOutputs.map((o) => ({
          identifier: o.identifier,
          type: o.type as LlmConfigOutputType,
          json_schema: o.json_schema as { type: string } | undefined,
        })),
      );
    },
    [],
  );

  return (
    <VStack align="start" width="full">
      <VerticalFormControl
        label="Model"
        invalid={!!errors.version?.configData?.llm}
        helper={errors.version?.configData?.llm?.message?.toString()}
        error={errors.version?.configData?.llm}
        size="sm"
      >
        <Controller
          name="version.configData.llm"
          control={control}
          render={({ field }) => {
            return (
              <OptimizationStudioLLMConfigField
                llmConfig={LLMConfigFormatUtils.formToDslFormat(field.value)}
                onChange={(values) => {
                  field.onChange(LLMConfigFormatUtils.dslToFormFormat(values));
                  void trigger?.("version.configData.llm");
                }}
                outputs={outputs}
                onOutputsChange={handleOutputsChange}
                showStructuredOutputs={true}
              />
            );
          }}
        />
      </VerticalFormControl>
    </VStack>
  );
}
