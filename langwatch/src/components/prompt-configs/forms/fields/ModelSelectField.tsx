import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

export function ModelSelectField() {
  const { register, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Model"
      invalid={!!errors.model}
      helper={errors.model?.message?.toString()}
      error={errors.model}
    >
      <Input placeholder="openai/gpt4-o-mini" {...register("model")} />
    </VerticalFormControl>
  );
}
