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
  /** Button variant (default: "primary") */
  variant?: "primary" | "secondary";
};

/**
 * Shared save button for prompts with "Update to vX" logic.
 * Shows:
 * - "Save" for new prompts
 * - "Update to vX" for existing prompts with changes OR not at latest version
 * - "Saved" when no changes AND at latest version
 *
 * Button is enabled when:
 * - There are unsaved changes, OR
 * - The current version is not the latest (allows "rollback" by publishing old version as new)
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
  variant = "primary"
}: SavePromptButtonProps) {
  const formMethods = useFormContext<PromptConfigFormValues>();
  const configId = formMethods.watch("configId");
  const currentVersion = formMethods.watch("versionMetadata.versionNumber");

  const { nextVersion, latestVersion } = useLatestPromptVersion({
    configId,
    currentVersion,
  });

  // Check if we're at the latest version
  const isAtLatestVersion = currentVersion === latestVersion;

  // Button should be enabled when:
  // - There are unsaved changes, OR
  // - We're not at the latest version (allows "rollback")
  const canSave = hasUnsavedChanges || !isAtLatestVersion;

  const getButtonLabel = () => {
    // Show "Saved" only when no changes AND at latest version
    if (!hasUnsavedChanges && isAtLatestVersion) return "Saved";
    if (nextVersion !== undefined) return `Update to v${nextVersion}`;
    return "Save";
  };

  return (
    <Button
      {...(variant === "primary" ? { colorPalette: "blue" } : { variant: "outline" })}
      size={size}
      onClick={onSave}
      disabled={!canSave || !isValid || isSaving}
      loading={isSaving}
      data-testid="save-prompt-button"
    >
      {getButtonLabel()}
    </Button>
  );
}
