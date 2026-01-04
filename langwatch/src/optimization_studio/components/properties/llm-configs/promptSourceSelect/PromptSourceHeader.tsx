import { HStack, Spacer, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompts";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import { EditablePromptHandleField } from "~/prompts/forms/fields/EditablePromptHandleField";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompts/forms/prompt-config-form/components/VersionSaveButton";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";

import { useNodeDrift } from "../signature-properties-panel/hooks/useNodeDrift";
import { useSyncPromptHandle } from "../signature-properties-panel/hooks/useSyncPromptHandle";
import { PromptSource } from "./PromptSource";
import { VersionedPromptLabel } from "./VersionedPromptLabel";

/**
 * Header for the prompt source select in the optimization studio
 */
export function PromptSourceHeader({
  node,
  onPromptSourceSelect,
}: {
  node: Node<LlmPromptConfigComponent>;
  onPromptSourceSelect: (config: { id: string; name: string }) => void;
}) {
  useSyncPromptHandle(node.data);
  const formProps = useFormContext<PromptConfigFormValues>();
  const { triggerSaveVersion, triggerCreatePrompt } = usePromptConfigContext();
  const isDirty = formProps.formState.isDirty;
  const { project } = useOrganizationTeamProject();
  const { hasDrift } = useNodeDrift(node);
  const configId = node.data.configId;

  const handleSaveVersion = useCallback(() => {
    const values = formProps.getValues();
    const newValues = formValuesToTriggerSaveVersionParams(values);

    const onSuccess = (prompt: VersionedPrompt) => {
      toaster.create({
        title: "Prompt saved",
        description: `Prompt ${prompt.handle} has been saved`,
        type: "success",
        duration: 2000,
      });
      // IMPORTANT: Use WithSystemMessage to include the system prompt in messages array
      formProps.reset(versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt));
    };

    const onError = () => {
      toaster.create({
        title: "Error saving version",
        description: "Failed to save version",
        type: "error",
      });
    };

    if (configId) {
      void triggerSaveVersion({
        id: configId,
        data: newValues,
        onSuccess,
        onError,
      });
    } else {
      triggerCreatePrompt({
        data: newValues,
        onSuccess,
        onError,
      });
    }
  }, [triggerSaveVersion, triggerCreatePrompt, formProps, configId]);

  /**
   * Assumption: After restoring a version, the latest version config should
   * match the restored version config.
   */
  const handleOnRestore = async (params: VersionedPrompt) => {
    // Update the form with the new values
    // IMPORTANT: Use WithSystemMessage to include the system prompt in messages array
    const newFormValues = versionedPromptToPromptConfigFormValuesWithSystemMessage(params);
    formProps.reset(newFormValues);
  };

  const handle = formProps.watch("handle");
  const isDraft = !Boolean(handle);
  const canSave = isDraft || hasDrift || isDirty;

  return (
    <VStack width="full" gap={0}>
      <VerticalFormControl
        label={<VersionedPromptLabel node={node} />}
        width="full"
        size="sm"
        paddingBottom={4}
      >
        <HStack
          justifyContent="space-between"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="md"
          padding={2}
          background="gray.50"
        >
          <EditablePromptHandleField />
          <Spacer />
          <GeneratePromptApiSnippetDialog
            promptHandle={handle}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
          <PromptSource
            selectedPromptId={configId}
            onSelect={onPromptSourceSelect}
          />
          {configId && (
            <VersionHistoryButton
              configId={configId}
              onRestoreSuccess={(params) => handleOnRestore(params)}
            />
          )}
          <VersionSaveButton
            disabled={!canSave}
            onClick={() => void handleSaveVersion()}
            hideLabel={true}
          />
        </HStack>
      </VerticalFormControl>
    </VStack>
  );
}
