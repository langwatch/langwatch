import { useFormContext, Controller } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";
import { ModelSelector, allModelOptions } from "../../../ModelSelector";

export function ModelSelectField() {
  const { control, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Model"
      invalid={!!errors.version?.model}
      helper={errors.version?.model?.message?.toString()}
      error={errors.version?.model}
    >
      <Controller
        name="version.model"
        control={control}
        render={({ field }) => (
          <ModelSelector
            model={field.value}
            options={allModelOptions}
            onChange={field.onChange}
            size="full"
            mode="chat"
          />
        )}
      />
    </VerticalFormControl>
  );
}
