import { Input, Text } from "@chakra-ui/react";
import { type ReactNode } from "react";
import { useFormContext, useFormState } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";

interface ReferenceIdFieldProps {
  // Optional label to override the default "Reference ID" label
  label?: string | ReactNode;
}

/**
 * Reference ID field component for prompt configuration forms
 * Single Responsibility: Handles the reference ID input field with validation, formatting, and change warnings
 */
export function ReferenceIdField({ label }: ReferenceIdFieldProps) {
  const { register, control } = useFormContext<PromptConfigFormValues>();
  const { errors, dirtyFields, defaultValues } = useFormState({ control });

  // Check if reference ID field is dirty (changed from original)
  const isReferenceIdDirty = dirtyFields.referenceId;
  const originalReferenceId = defaultValues?.referenceId;
  const hasOriginalId =
    originalReferenceId && originalReferenceId.trim() !== "";

  // Show warning when user has changed an existing reference ID
  const showWarning = isReferenceIdDirty && hasOriginalId;

  console.log({
    isReferenceIdDirty,
    originalReferenceId,
    hasOriginalId,
    showWarning,
  });

  return (
    <VerticalFormControl
      label={label ?? "Reference ID"}
      invalid={!!errors.referenceId}
      tooltip="Optional unique identifier for easy reference (e.g., team/project/prompt). Once set, avoid changing to prevent breaking existing integrations."
      error={errors.referenceId}
      size="sm"
    >
      <Input
        size="sm"
        placeholder="team/project/prompt"
        {...register("referenceId")}
      />
      {showWarning && (
        <Text color="red.500" fontSize="12px" fontWeight="medium" mt={2}>
          ⚠️ Warning: Changing this reference ID will break any existing
          integrations, API calls, or workflows that use "{originalReferenceId}
          ". Make sure to update all references in your codebase and
          documentation.
        </Text>
      )}
    </VerticalFormControl>
  );
}
