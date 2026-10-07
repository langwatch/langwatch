import { Box, Button, HStack, useDisclosure } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { DeployPromptDialog } from "~/prompts/components/DeployPromptDialog";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { SavePromptButton } from "~/prompts/components/SavePromptButton";
import { ModelSelectFieldMini } from "~/prompts/forms/fields/ModelSelectFieldMini";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
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
 * Shared header component for prompt editing.
 * Used in both the prompt playground and the prompt editor drawer.
 *
 * Features:
 * - Model selector
 * - Version history (if prompt exists)
 * - API snippet button
 * - Save button with "Update to vX" logic
 *
 * On an aggregate project (ADR-144), which keeps no prompts of its own and
 * refuses every write, a tab carried over from another project offers
 * neither Save nor Deploy.
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
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");
  const deployDialog = useDisclosure();
  const acceptsWrites = !isAggregateProjectKind(project?.kind);

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
          {acceptsWrites && configId && handle && project?.id && (
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
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
          {acceptsWrites && (
            <SavePromptButton
              onSave={onSave}
              hasUnsavedChanges={hasUnsavedChanges}
              isValid={isValid}
              isSaving={isSaving}
            />
          )}
        </HStack>
      )}
    </Box>
  );
}
