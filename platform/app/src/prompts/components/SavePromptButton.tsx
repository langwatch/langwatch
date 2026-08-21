import { Button } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { Tooltip } from "~/components/ui/tooltip";
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
 * Shared save button for prompts.
 *
 * The button covers two different actions, so it is labelled for the action
 * rather than for the version number the action happens to produce:
 * - "Save changes" when the editor holds edits, which become a new version
 * - "Make this the latest version" when there are no edits but an older
 *   version is loaded, which republishes that version as the latest one
 * - "No changes to save" when there is nothing to do
 * - "Save" for a prompt that has no versions yet
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
  variant = "primary",
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
    if (!hasUnsavedChanges && isAtLatestVersion) return "No changes to save";
    // A prompt with no versions yet has nothing to be the latest of.
    if (nextVersion === undefined) return "Save";
    if (hasUnsavedChanges) return "Save changes";
    return "Make this the latest version";
  };

  const button = (
    <Button
      {...(variant === "primary"
        ? { colorPalette: "blue" }
        : { variant: "outline" })}
      size={size}
      onClick={onSave}
      disabled={!canSave || !isValid || isSaving}
      loading={isSaving}
      data-testid="save-prompt-button"
    >
      {getButtonLabel()}
    </Button>
  );

  // The version number is the result, not the action, so it supports the
  // label rather than replacing it.
  if (!canSave || nextVersion === undefined) return button;

  return (
    <Tooltip
      content={`Saves as version ${nextVersion}`}
      positioning={{ placement: "top" }}
    >
      {button}
    </Tooltip>
  );
}
