import { Button, HStack, Spacer } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { ModelSelectFieldMini } from "~/prompts/forms/fields/ModelSelectFieldMini";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

export type PromptEditorHeaderProps = {
  /** Callback when save button is clicked */
  onSave: () => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Whether the form is valid */
  isValid?: boolean;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Callback when a version is restored from history */
  onVersionRestore?: (prompt: VersionedPrompt) => Promise<void>;
  /** Callback when changes are discarded */
  onDiscardChanges?: () => void;
  /** Optional custom save button (for playground that uses different save logic) */
  customSaveButton?: React.ReactNode;
};

/**
 * Shared header component for prompt editing.
 * Used in both the prompt playground and the prompt editor drawer.
 *
 * Features:
 * - Model selector
 * - Version history (if prompt exists)
 * - API snippet button
 * - Save button
 */
export function PromptEditorHeader({
  onSave,
  hasUnsavedChanges,
  isValid = true,
  isSaving = false,
  onVersionRestore,
  onDiscardChanges,
  customSaveButton,
}: PromptEditorHeaderProps) {
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");

  return (
    <HStack width="full">
      <HStack>
        <ModelSelectFieldMini />
      </HStack>
      <Spacer />
      <HStack gap={2}>
        {configId && onVersionRestore && (
          <VersionHistoryButton
            configId={configId}
            onRestoreSuccess={onVersionRestore}
            onDiscardChanges={onDiscardChanges}
            hasUnsavedChanges={hasUnsavedChanges}
          />
        )}
        <GeneratePromptApiSnippetDialog
          promptHandle={handle}
          apiKey={project?.apiKey}
        >
          <GeneratePromptApiSnippetDialog.Trigger>
            <GenerateApiSnippetButton hasHandle={!!handle} />
          </GeneratePromptApiSnippetDialog.Trigger>
        </GeneratePromptApiSnippetDialog>
        {customSaveButton ?? (
          <Button
            colorPalette="blue"
            size="sm"
            onClick={onSave}
            disabled={!hasUnsavedChanges || !isValid || isSaving}
            loading={isSaving}
            data-testid="save-prompt-button"
          >
            {hasUnsavedChanges ? "Save" : "Saved"}
          </Button>
        )}
      </HStack>
    </HStack>
  );
}
