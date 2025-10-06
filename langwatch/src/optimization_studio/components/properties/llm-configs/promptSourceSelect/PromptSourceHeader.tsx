import { HStack, Spacer, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { type PromptConfigFormValues } from "~/prompt-configs";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { EditablePromptHandleField } from "~/prompt-configs/forms/fields/EditablePromptHandleField";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";

import { useNodeDrift } from "../signature-properties-panel/hooks/useNodeDrift";

import { PromptSource } from "./PromptSource";
import { VersionedPromptLabel } from "./VersionedPromptLabel";

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
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveVersion = useCallback(() => {
    setIsSaving(true);
    const values = formProps.getValues();
    const newValues = formValuesToTriggerSaveVersionParams(values);

    if (!configId) {
      throw new Error("Config ID is required");
    }

    const onSuccess = (prompt: VersionedPrompt) => {
      toaster.create({
        title: "Version saved",
        description: "Version has been saved",
        type: "success",
      });
      formProps.reset(versionedPromptToPromptConfigFormValues(prompt));
      setIsSaving(false);
    };

    const onError = () => {
      toaster.create({
        title: "Error saving version",
        description: "Failed to save version",
        type: "error",
      });
      setIsSaving(false);
    };

    triggerSaveVersion({
      id: configId,
      data: newValues,
      onSuccess,
      onError,
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
            isSaving={isSaving}
          />
        </HStack>
      </VerticalFormControl>
    </VStack>
  );
}
