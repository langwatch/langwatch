import { HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useFormContext } from "react-hook-form";

import { PromptSource } from "./PromptSource";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { type PromptConfigFormValues } from "~/prompt-configs";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { PromptDriftWarning } from "../signature-properties-panel/PromptDriftWarning";
import { useNodeDrift } from "../signature-properties-panel/hooks/useNodeDrift";
import type { VersionedPrompt } from "~/server/prompt-config";
import { toaster } from "~/components/ui/toaster";
import { useCallback } from "react";
import { EditablePromptHandleField } from "~/prompt-configs/forms/fields/EditablePromptHandleField";

/**
 * Header for the prompt source select in the optimization studio
 * @param param0
 * @returns
 */
export function PromptSourceHeader({
  node,
  onPromptSourceSelect,
}: {
  node: Node<LlmPromptConfigComponent>;
  onPromptSourceSelect: (config: { id: string; name: string }) => void;
}) {
  const formProps = useFormContext<PromptConfigFormValues>();
  const { triggerSaveVersion } = usePromptConfigContext();
  const isDirty = formProps.formState.isDirty;
  const { project } = useOrganizationTeamProject();
  const { hasDrift } = useNodeDrift(node);
  const configId = node.data.configId;

  const handleSaveVersion = useCallback(() => {
    const values = formProps.getValues();
    const newValues = formValuesToTriggerSaveVersionParams(values);

    if (!configId) {
      throw new Error("Config ID is required");
    }

    void triggerSaveVersion({
      id: configId,
      data: newValues,
    })
      .then((prompt) => {
        toaster.create({
          title: "Version saved",
          description: "Version has been saved",
          type: "success",
        });
        formProps.reset(versionedPromptToPromptConfigFormValues(prompt));
      })
      .catch(() => {
        toaster.create({
          title: "Error saving version",
          description: "Failed to save version",
          type: "error",
        });
      });
  }, [triggerSaveVersion, formProps, configId]);

  /**
   * Assumption: After restoring a version, the latest version config should
   * match the restored version config.
   */
  const handleOnRestore = async (params: VersionedPrompt) => {
    // Update the form with the new values
    const newFormValues = versionedPromptToPromptConfigFormValues(params);
    formProps.reset(newFormValues);
  };

  const handle = formProps.watch("handle");
  const isDraft = !Boolean(handle);
  const canSave = isDraft || hasDrift || isDirty;

  return (
    <VStack width="full" gap={0}>
      <VerticalFormControl
        label="Versioned Prompt"
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
            configId={configId}
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
          {node.data.configId && (
            <VersionHistoryButton
              configId={node.data.configId}
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
      <PromptDriftWarning node={node} />
    </VStack>
  );
}
