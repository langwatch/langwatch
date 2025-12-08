import { VStack } from "@chakra-ui/react";
import { Controller, useFormContext } from "react-hook-form";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import type { PromptConfigFormValues } from "~/prompts";
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
              />
            );
          }}
        />
      </VerticalFormControl>
    </VStack>
  );
}
