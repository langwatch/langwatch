import { Input } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { VerticalFormControl } from "../../../VerticalFormControl";
import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

interface CommitMessageFieldProps {
  label: React.ReactNode;
}

export function CommitMessageField({ label }: CommitMessageFieldProps) {
  const { register, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label={label ?? "Description"}
      invalid={!!errors.version?.commitMessage}
      helper={errors.version?.commitMessage?.message?.toString()}
      error={errors.version?.commitMessage}
    >
      <Input
        placeholder="Enter a description for this version"
        {...register("version.commitMessage")}
      />
    </VerticalFormControl>
  );
}
