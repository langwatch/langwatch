import { HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useFormContext } from "react-hook-form";

import { PromptSource } from "./PromptSource";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { usePrompts, type PromptConfigFormValues } from "~/prompt-configs";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { createLogger } from "~/utils/logger";
import { PromptDriftWarning } from "../signature-properties-panel/PromptDriftWarning";
import { useNodeDrift } from "../signature-properties-panel/hooks/use-node-drift";

const logger = createLogger(
  "langwatch:optimization_studio:prompt_source_header"
);

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
  const { projectId = "" } = useOrganizationTeamProject();
  const configId = node.data.configId;
  const formProps = useFormContext<PromptConfigFormValues>();
  const { triggerSaveVersion } = usePromptConfigContext();
  const isDirty = formProps.formState.isDirty;
  const { getPromptById } = usePrompts();
  const { project } = useOrganizationTeamProject();
  const { hasDrift } = useNodeDrift(node);

  const handleSaveVersion = () => {
    const values = formProps.getValues();
    /**
     * Save new data to the database
     */
    triggerSaveVersion({
      data: formValuesToTriggerSaveVersionParams(values),
      onSuccess: (prompt) => {
        // Update the node data with the new prompt
        formProps.reset(versionedPromptToPromptConfigFormValues(prompt));
      },
    });
  };

  /**
   * Assumption: After restoring a version, the latest version config should
   * match the restored version config.
   */
  const handleOnRestore = async (params: {
    versionId: string;
    configId: string;
  }) => {
    const { versionId, configId } = params;

    try {
      // Get the latest versioned prompt
      const prompt = await getPromptById({
        id: configId,
        projectId,
      });

      if (!prompt) {
        throw new Error("Prompt not found");
      }

      // Update the form with the new values
      const newFormValues = versionedPromptToPromptConfigFormValues(prompt);
      formProps.reset(newFormValues);
    } catch (error) {
      logger.error({ error, versionId }, "Failed to restore prompt version");
      toaster.error({
        title: "Failed to restore prompt version",
        description: "Please try again.",
      });
    }
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
          <HStack paddingX={1} gap={1}>
            {isDraft ? (
              <Text color="gray.500">Draft</Text>
            ) : (
              <Text
                fontSize="sm"
                fontWeight="500"
                fontFamily="mono"
                fontStyle={canSave ? "italic" : "normal"}
              >
                {handle}
              </Text>
            )}
          </HStack>
          <Spacer />
          <GeneratePromptApiSnippetDialog
            configId={configId}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton hasHandle={!!handle} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
          <PromptSource configId={configId} onSelect={onPromptSourceSelect} />
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
