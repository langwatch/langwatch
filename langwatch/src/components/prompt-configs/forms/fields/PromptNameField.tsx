import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";

export function PromptNameField({ id = "name" }: { id?: string } = {}) {
  const { register, formState } = useFormContext();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Name"
      invalid={!!errors.name}
      helper={errors.name?.message?.toString()}
      error={errors.name}
    >
      <Input
        id={id}
        placeholder="Enter a name for this prompt"
        {...register("name")}
      />
    </VerticalFormControl>
  );
}
