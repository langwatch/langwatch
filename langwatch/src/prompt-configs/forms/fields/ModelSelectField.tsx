import { useFormContext, Controller } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { ModelSelector, allModelOptions } from "~/components/ModelSelector";
import { VerticalFormControl } from "~/components/VerticalFormControl";

export function ModelSelectField() {
  const { control, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Model"
      invalid={!!errors.version?.configData?.model}
      helper={errors.version?.configData?.model?.message?.toString()}
      error={errors.version?.configData?.model}
    >
      <Controller
        name="version.configData.model"
        control={control}
        render={({ field }) => {
          return (
            <ModelSelector
              model={field.value}
              options={allModelOptions}
              onChange={field.onChange}
              size="full"
              mode="chat"
            />
          );
        }}
      />
    </VerticalFormControl>
  );
}
