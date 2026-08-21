import {
  Badge,
  Button,
  Circle,
  HStack,
  IconButton,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { LuActivity } from "react-icons/lu";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { Tooltip } from "~/components/ui/tooltip";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { DeployPromptDialog } from "~/prompts/components/DeployPromptDialog";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { SavePromptButton } from "~/prompts/components/SavePromptButton";
import { ModelSelectFieldMini } from "~/prompts/forms/fields/ModelSelectFieldMini";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { useRouter } from "~/utils/compat/next-router";

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
  /** Show the playground's compact version, deployment and usage context. */
  showPromptContext?: boolean;
};

function PromptContextSummary({ configId }: { configId: string }) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { data } = useAllPromptsForProject();
  const prompt = data?.find((candidate) => candidate.id === configId);
  if (!prompt) return null;

  const liveTags = prompt.tags.filter(({ name }) => name !== "latest");
  const author =
    prompt.author?.name?.trim() ||
    prompt.author?.email?.trim() ||
    "Unknown author";
  const initials = author
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const openTraces = () => {
    const filters = useFilterStore.getState();
    filters.removeField("lastUsedPrompt");
    filters.toggleFacet("lastUsedPrompt", prompt.id);
    if (prompt.handle && prompt.handle !== prompt.id) {
      useFilterStore.getState().toggleFacet("lastUsedPrompt", prompt.handle);
    }
    if (project?.slug) void router.push(`/${project.slug}/traces`);
  };

  return (
    <HStack gap={1} minWidth={0} overflow="hidden">
      <Tooltip content={`Latest saved version: v${prompt.version}`}>
        <Badge size="xs" variant="subtle" colorPalette="gray" flexShrink={0}>
          v{prompt.version}
        </Badge>
      </Tooltip>
      {liveTags.slice(0, 2).map(({ name }) => (
        <Tooltip key={name} content={`${name} points to v${prompt.version}`}>
          <Badge
            size="xs"
            variant="subtle"
            colorPalette="green"
            maxWidth="82px"
          >
            <Text as="span" truncate>
              {name}
            </Text>
          </Badge>
        </Tooltip>
      ))}
      <Tooltip content={`Last changed by ${author}`}>
        <Circle
          size="20px"
          background="bg.muted"
          color="fg.muted"
          textStyle="2xs"
          fontWeight="semibold"
          flexShrink={0}
          aria-label={`Last changed by ${author}`}
        >
          {initials || "?"}
        </Circle>
      </Tooltip>
      <Tooltip content="View traces and evaluator results for this prompt">
        <IconButton
          aria-label="View traces and evaluator results for this prompt"
          size="xs"
          variant="ghost"
          onClick={openTraces}
        >
          <LuActivity size={13} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}

/**
 * Shared header component for prompt editing.
 * Used in both the prompt playground and the prompt editor drawer.
 *
 * Features:
 * - Model selector
 * - Version history (if prompt exists)
 * - API snippet button
 * - Save button with "Update to vX" logic
 */
export function PromptEditorHeader({
  onSave,
  hasUnsavedChanges,
  isValid = true,
  isSaving = false,
  onVersionRestore,
  variant = "full",
  openHistoryOnLoad,
  showPromptContext = false,
}: PromptEditorHeaderProps) {
  const { project } = useOrganizationTeamProject();
  const formMethods = useFormContext<PromptConfigFormValues>();
  const handle = formMethods.watch("handle");
  const configId = formMethods.watch("configId");
  const deployDialog = useDisclosure();

  return (
    <HStack
      width="full"
      gap={3}
      alignItems="center"
      justifyContent="space-between"
    >
      <HStack flex={1} minWidth={0} gap={2} overflow="hidden">
        <ModelSelectFieldMini />
        {showPromptContext && configId && (
          <PromptContextSummary configId={configId} />
        )}
      </HStack>
      {variant === "full" && (
        // A compact row. These are the prompt's management actions — publish
        // it, call it, save a version — and they sat at the same weight as the
        // prompt itself, which is what the pane is actually for. One primary
        // (the save) with the rest as quiet outlines, all on the strip's own
        // button scale.
        <HStack gap={1.5} flexShrink={0}>
          {configId && onVersionRestore && (
            <VersionHistoryButton
              triggerSize="xs"
              configId={configId}
              currentVersionId={formMethods.watch("versionMetadata")?.versionId}
              onRestoreSuccess={onVersionRestore}
              hasUnsavedChanges={hasUnsavedChanges}
              initialOpen={openHistoryOnLoad}
            />
          )}
          {configId && handle && project?.id && (
            <>
              <Button variant="outline" size="xs" onClick={deployDialog.onOpen}>
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
              <GenerateApiSnippetButton hasHandle={!!handle} size="xs" />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
          <SavePromptButton
            onSave={onSave}
            hasUnsavedChanges={hasUnsavedChanges}
            isValid={isValid}
            isSaving={isSaving}
            size="xs"
          />
        </HStack>
      )}
    </HStack>
  );
}
