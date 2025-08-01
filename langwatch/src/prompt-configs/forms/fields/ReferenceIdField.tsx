import { Input } from "@chakra-ui/react";
import { type ReactNode } from "react";
import { useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";

interface ReferenceIdFieldProps {
  // Optional label to override the default "Reference ID" label
  label?: string | ReactNode;
}

/**
 * Reference ID field component for prompt configuration forms
 * Single Responsibility: Handles the reference ID input field with validation and formatting
 */
export function ReferenceIdField({ label }: ReferenceIdFieldProps) {
  const { register, formState } = useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  return (
    <VerticalFormControl
      label={label ?? "Reference ID"}
      invalid={!!errors.referenceId}
      tooltip="Unique identifier in format team/project/prompt (optional, leave empty for draft)"
      error={errors.referenceId}
      size="sm"
    >
      <Input
        size="sm"
        placeholder="team/project/prompt"
        {...register("referenceId")}
      />
    </VerticalFormControl>
  );
}
