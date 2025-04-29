import { Controller, useFormContext } from "react-hook-form";

import { OptimizationStudioLLMConfigField } from "./OptimizationStudioLLMConfigField";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";

/**
 * Wrapped OptimizationStudioLLMConfigField that works with
 * the Form field
 */
export function WrappedOptimizationStudioLLMConfigField() {
  const { control, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
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
              llmConfig={field.value as LLMConfig}
              onChange={field.onChange}
            />
          );
        }}
      />
    </VerticalFormControl>
  );
}
