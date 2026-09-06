import { Button, HStack, Spacer } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { SavePromptButton } from "~/prompts/components/SavePromptButton";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

export type PromptEditorFooterProps = {
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
  /** The prompt config ID (needed for version history) */
  configId?: string;
  /** The prompt handle (needed for API snippet) */
  handle?: string;
  /** The current version ID (needed for version history) */
  currentVersionId?: string;
  /** Callback when Apply is clicked; button only shown when provided */
  onApply?: () => void;
  /** Callback when Discard is clicked; button only shown when provided */
  onDiscard?: () => void;
};

/**
 * Footer component for the prompt editor in drawer mode.
 * Renders the action buttons that are hidden from the header when using variant="model-only":
 * History, API snippet, Save, and optionally Discard/Apply.
 *
 * Layout: [Discard?] [Spacer] [History] [API] [Save] [Apply?]
 */
export function PromptEditorFooter({
  onSave,
  hasUnsavedChanges,
  isValid = true,
  isSaving = false,
  onVersionRestore,
  configId: configIdProp,
  handle: handleProp,
  currentVersionId,
  onApply,
  onDiscard,
}: PromptEditorFooterProps) {
  const { project } = useOrganizationTeamProject();
  // Form context may not be available when rendered outside FormProvider
  // (e.g., in Drawer.Footer or StudioDrawerWrapper footer slot).
  // Falls back gracefully when all values are provided via props.
  const formMethods = useFormContext<PromptConfigFormValues>();

  // Use props if provided, otherwise fall back to form context
  const handle = handleProp ?? formMethods?.watch("handle");
  const configId = configIdProp ?? formMethods?.watch("configId");
  const versionId =
    currentVersionId ?? formMethods?.watch("versionMetadata")?.versionId;

  return (
    <HStack gap={2} width="full">
      {onDiscard && (
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      )}
      <Spacer />
      {configId && onVersionRestore && (
        <VersionHistoryButton
          configId={configId}
          currentVersionId={versionId}
          onRestoreSuccess={onVersionRestore}
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
      <SavePromptButton
        onSave={onSave}
        hasUnsavedChanges={hasUnsavedChanges}
        isValid={isValid}
        isSaving={isSaving}
        variant="secondary"
      />
      {onApply && (
        <Button colorPalette="blue" size="sm" onClick={onApply}>
          Apply
        </Button>
      )}
    </HStack>
  );
}
