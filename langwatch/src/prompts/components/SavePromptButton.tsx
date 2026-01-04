import { Button } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";

export type SavePromptButtonProps = {
  /** Callback when save button is clicked */
  onSave: () => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Whether the form is valid (default: true) */
  isValid?: boolean;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Button size (default: "sm") */
  size?: "xs" | "sm" | "md" | "lg";
};

/**
 * Shared save button for prompts with "Update to vX" logic.
 * Shows:
 * - "Save" for new prompts
 * - "Update to vX" for existing prompts with changes (X = latest DB version + 1)
 * - "Saved" when no changes
 *
 * Uses the actual latest version from the database, not just current + 1,
 * to handle cases where the prompt was updated in another tab/session.
 *
 * Used by both prompt playground and prompt editor drawer.
 */
export function SavePromptButton({
  onSave,
  hasUnsavedChanges,
  isValid = true,
  isSaving = false,
  size = "sm",
}: SavePromptButtonProps) {
  const formMethods = useFormContext<PromptConfigFormValues>();
  const configId = formMethods.watch("configId");
  const currentVersion = formMethods.watch("versionMetadata.versionNumber");

  const { nextVersion } = useLatestPromptVersion({ configId, currentVersion });

  const getButtonLabel = () => {
    if (!hasUnsavedChanges) return "Saved";
    if (nextVersion !== undefined) return `Update to v${nextVersion}`;
    return "Save";
  };

  return (
    <Button
      colorPalette="blue"
      size={size}
      onClick={onSave}
      disabled={!hasUnsavedChanges || !isValid || isSaving}
      loading={isSaving}
      data-testid="save-prompt-button"
    >
      {getButtonLabel()}
    </Button>
  );
}
