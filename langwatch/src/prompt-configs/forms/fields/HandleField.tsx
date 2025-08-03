import { Input, Text } from "@chakra-ui/react";
import { type ReactNode } from "react";
import { useFormContext, useFormState } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";

interface HandleFieldProps {
  // Optional label to override the default "Handle" label
  label?: string | ReactNode;
}

/**
 * Handle field component for prompt configuration forms
 * Single Responsibility: Handles the handle input field with validation, formatting, and change warnings
 */
export function HandleField({ label }: HandleFieldProps) {
  const { register, control } = useFormContext<PromptConfigFormValues>();
  const { errors, dirtyFields, defaultValues } = useFormState({ control });

  // Check if handle field is dirty (changed from original)
  const isHandleDirty = dirtyFields.handle;
  const originalHandle = defaultValues?.handle;
  const hasOriginalHandle = originalHandle && originalHandle.trim() !== "";

  // Show warning when user has changed an existing handle
  const showWarning = isHandleDirty && hasOriginalHandle;

  return (
    <VerticalFormControl
      label={label ?? "Handle"}
      invalid={!!errors.handle}
      helper="Optional unique identifier for easy reference (e.g., team/sample-prompt). Once set, avoid changing to prevent breaking existing integrations."
      error={errors.handle}
      size="sm"
    >
      <Input
        size="sm"
        placeholder="namespace/prompt-name"
        {...register("handle")}
      />
      {showWarning && (
        <Text color="red.500" fontSize="12px" fontWeight="medium" mt={2}>
          ⚠ Warning: Changing this handle will break any existing integrations,
          API calls, or workflows that use &quot;{originalHandle}
          &quot;. Make sure to update all references in your codebase and
          documentation.
        </Text>
      )}
    </VerticalFormControl>
  );
}
