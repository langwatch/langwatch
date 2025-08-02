import { Input, Text } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import { useFormContext, useFormState } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import { usePromptReferenceIdCheck } from "~/hooks/prompts/usePromptReferenceIdCheck";
import { createLogger } from "~/utils/logger";

const logger = createLogger("ReferenceIdField");

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
  const [isValid, setIsValid] = useState(true);
  const { checkReferenceIdUniqueness } = usePromptReferenceIdCheck();

  // Check if reference ID field is dirty (changed from original)
  const isReferenceIdDirty = dirtyFields.referenceId;
  const originalReferenceId = defaultValues?.referenceId;
  const hasOriginalId =
    originalReferenceId && originalReferenceId.trim() !== "";

  // Show warning when user has changed an existing reference ID
  const showWarning = isReferenceIdDirty && hasOriginalId;

  return (
    <VerticalFormControl
      label={label ?? "Reference ID"}
      invalid={!!errors.referenceId || !isValid}
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
          ⚠ Warning: Changing this reference ID will break any existing
          integrations, API calls, or workflows that use &quot;
          {originalReferenceId}
          &quot;. Make sure to update all references in your codebase and
          documentation.
        </Text>
      )}
      {/* {!isValid && (
        <Text color="red.500" fontSize="12px" fontWeight="medium" mt={2}>
          ⚠ Reference id must be unique.
        </Text>
      )} */}
    </VerticalFormControl>
  );
}
