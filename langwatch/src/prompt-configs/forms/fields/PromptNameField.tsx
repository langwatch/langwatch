import { Input } from "@chakra-ui/react";
import { type ReactNode } from "react";
import { useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";

interface PromptNameFieldProps {
  // Optional label to override the default "Prompt Name" label
  label?: string | ReactNode;
}

export function PromptNameField({ label }: PromptNameFieldProps) {
  const { register, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label={label ?? "Prompt Name"}
      invalid={!!errors.name}
      error={errors.name}
      size="sm"
    >
      <Input
        size="sm"
        placeholder="Enter a name for this prompt"
        {...register("name")}
      />
    </VerticalFormControl>
  );
}
