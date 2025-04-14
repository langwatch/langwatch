import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";

export function ModelSelectField({ id = "model" }: { id?: string } = {}) {
  const { register, formState } = useFormContext();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Model"
      invalid={!!errors.model}
      helper={errors.model?.message?.toString()}
      error={errors.model}
    >
      <Input id={id} placeholder="openai/gpt4-o-mini" {...register("model")} />
    </VerticalFormControl>
  );
}
