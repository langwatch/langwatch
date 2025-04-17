import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

export function PromptNameField() {
  const { register, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Prompt Name"
      invalid={!!errors.name}
      helper={errors.name?.message?.toString()}
      error={errors.name}
    >
      <Input placeholder="Enter a name for this prompt" {...register("name")} />
    </VerticalFormControl>
  );
}
