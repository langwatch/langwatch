import { useFormContext, Controller } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import { VerticalFormControl } from "~/components/VerticalFormControl";

export function ModelSelectField() {
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
            <LLMConfigField
              llmConfig={field.value ?? {}} // Prevent a runtime error if the value is undefined
              onChange={field.onChange}
              requiresCustomKey={false}
            />
          );
        }}
      />
    </VerticalFormControl>
  );
}
