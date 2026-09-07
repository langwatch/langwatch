import type { WireVersionedPrompt } from "../../model/wire-versioned-prompt.ts";
import { Box, Button, HStack, useDisclosure } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "./dialogs/generate-api-snippet-button.tsx";
import { usePromptProject } from "../../behavior/use-prompt-project.ts";
import { DeployPromptDialog } from "./dialogs/deploy-prompt-dialog.tsx";
import { GeneratePromptApiSnippetDialog } from "./dialogs/generate-prompt-api-snippet-dialog.tsx";
import { SavePromptButton } from "./save-prompt-button.tsx";
import { ModelSelectFieldMini } from "./fields/model-select-field-mini.tsx";
import { VersionHistoryButton } from "./version-history-button.tsx";
import { type PromptConfigFormValues } from "@langwatch/prompt-contract";

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
  onVersionRestore?: (prompt: WireVersionedPrompt) => Promise<void>;
  /**
   * Controls which elements are rendered.
   * - "full" (default): model selector + history, API, and save buttons
   * - "model-only": only the model selector (for use in drawers where buttons move to a footer)
   */
  variant?: "full" | "model-only";
  /** When true the version history panel opens automatically on mount. */
  openHistoryOnLoad?: boolean;
};

/**
 * Shared header for prompt editing, used in both the playground and the
 * editor drawer: model selector, version history, API snippet button, and
 * a save button with "Update to vX" logic.
 */
export function PromptEditorHeader({
  onSave,
  hasUnsavedChanges,
  isValid = true,
  isSaving = false,
  onVersionRestore,
  variant = "full",
  openHistoryOnLoad,
}: PromptEditorHeaderProps) {
  const { project } = usePromptProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");
  const deployDialog = useDisclosure();

  return (
    <Box width="full" display="flex" gap={8} justifyContent="space-between">
      <ModelSelectFieldMini />
      {variant === "full" && (
        <HStack gap={2} flexShrink={0}>
          {configId && onVersionRestore && (
            <VersionHistoryButton
              configId={configId}
              currentVersionId={formMethods.watch("versionMetadata")?.versionId}
              onRestoreSuccess={onVersionRestore}
              hasUnsavedChanges={hasUnsavedChanges}
              initialOpen={openHistoryOnLoad}
            />
          )}
          {configId && handle && project?.id && (
            <>
              <Button variant="outline" size="sm" onClick={deployDialog.onOpen}>
                Deploy
              </Button>
              <DeployPromptDialog
                isOpen={deployDialog.open}
                onClose={deployDialog.onClose}
                configId={configId}
                handle={handle}
                projectId={project.id}
              />
            </>
          )}
          <GeneratePromptApiSnippetDialog
            promptHandle={handle}
            apiKey={project?.apiKey}
            variables={formMethods.watch("version.configData.inputs")}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
          <SavePromptButton
            onSave={onSave}
            hasUnsavedChanges={hasUnsavedChanges}
            isValid={isValid}
            isSaving={isSaving}
          />
        </HStack>
      )}
    </Box>
  );
}
