import { Controller, useFormContext } from "react-hook-form";

import { OptimizationStudioLLMConfigField } from "./OptimizationStudioLLMConfigField";

import { VStack } from "@chakra-ui/react";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompts";

/**
 * Convert form LLM config format (camelCase) to DSL format (snake_case)
 */
function formToDslFormat(formLlm: any): LLMConfig {
  return {
    model: formLlm.model,
    temperature: formLlm.temperature,
    max_tokens: formLlm.maxTokens,
    litellm_params: formLlm.litellmParams,
  };
}

/**
 * Convert DSL LLM config format (snake_case) to form format (camelCase)
 */
function dslToFormFormat(dslLlm: LLMConfig): any {
  return {
    model: dslLlm.model,
    temperature: dslLlm.temperature,
    maxTokens: dslLlm.max_tokens,
    litellmParams: dslLlm.litellm_params,
  };
}

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
                llmConfig={formToDslFormat(field.value)}
                onChange={(values) => {
                  field.onChange(dslToFormFormat(values));
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
