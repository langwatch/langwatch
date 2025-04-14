import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";

export function CommitMessageField({
  id = "commitMessage",
}: { id?: string } = {}) {
  const { register, formState } = useFormContext();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Description"
      invalid={!!errors.commitMessage}
      helper={errors.commitMessage?.message?.toString()}
      error={errors.commitMessage}
    >
      <Input
        id={id}
        placeholder="Enter a description for this version"
        {...register("commitMessage")}
      />
    </VerticalFormControl>
  );
}
