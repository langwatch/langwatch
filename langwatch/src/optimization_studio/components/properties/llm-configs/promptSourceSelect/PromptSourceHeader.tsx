import { HStack, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import { useFormContext } from "react-hook-form";

import { parseLlmConfigVersion } from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { PromptSource } from "./PromptSource";

import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { useGetPromptConfigByIdWithLatestVersionQuery } from "~/prompt-configs/hooks/useGetPromptConfigByIdWithLatestVersionQuery";
import { type PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";
import {
  llmConfigToOptimizationStudioNodeData,
  llmConfigToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { CopyButton } from "../../../../../components/CopyButton";

const logger = createLogger(
  "langwatch:optimization_studio:prompt_source_header"
);

export function PromptSourceHeader({
  node,
  onPromptSourceSelect,
  triggerSaveVersion,
  values,
}: {
  node: Node<LlmPromptConfigComponent>;
  onPromptSourceSelect: (config: { id: string; name: string }) => void;
  triggerSaveVersion: (
    config: LlmConfigWithLatestVersion,
    formValues: PromptConfigFormValues
  ) => void;
  values: PromptConfigFormValues;
}) {
  const trpc = api.useContext();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const configId = node.data.configId;
  const setNode = useSmartSetNode();
  const formProps = useFormContext<PromptConfigFormValues>();

  // Fetch the saved configuration to compare with current node data
  const { data: savedConfig } =
    useGetPromptConfigByIdWithLatestVersionQuery(configId);

  const { mutateAsync: createConfig } =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();

  /**
   * Determines if the current node data has changed from the saved configuration
   * Used to enable/disable the save button
   */
  const hasDrifted = useMemo(() => {
    if (!savedConfig) return false;
    const savedConfigData = llmConfigToOptimizationStudioNodeData(savedConfig);
    return !isEqual(node.data, savedConfigData);
  }, [node.data, savedConfig]);

  // TODO: Move this outside of the component
  const handleSaveVersion = async () => {
    // If no saved config, we will need to create a new one
    if (!savedConfig) {
      try {
        const newConfig = await createConfig({
          projectId,
        });

        // Update the node data with the new config ID
        setNode({
          ...node,
          data: {
            ...node.data,
            configId: newConfig.id,
          },
        });

        // Trigger the save version mutation for the new config
        triggerSaveVersion(newConfig, values);
      } catch (error) {
        console.error(error);
        toaster.error({
          title: "Failed to save prompt version",
          description: "Please try again.",
        });
      }
    } else {
      triggerSaveVersion(savedConfig, values);
    }
  };

  // TODO: Move this outside of the component
  const handleRestore = (versionId: string) => {
    void (async () => {
      if (!savedConfig) {
        // This should never happen
        logger.error({ versionId, projectId }, "Missing llm prompt config");
        toaster.error({
          title: "Failed to restore prompt version",
          description: "Missing prompt",
        });
        return;
      }

      try {
        // Get the saved version by id
        const savedVersion = await trpc.llmConfigs.versions.getById.fetch({
          versionId,
          projectId,
        });

        // Convert the saved version to a form values object
        const newFormValues = llmConfigToPromptConfigFormValues({
          ...savedConfig,
          latestVersion: parseLlmConfigVersion(savedVersion),
        });

        // Update the form values
        const currentFormValues = formProps.getValues();
        formProps.reset({
          ...currentFormValues,
          version: newFormValues.version,
        });
      } catch (error) {
        logger.error({ error, versionId }, "Failed to restore prompt version");
        toaster.error({
          title: "Failed to restore prompt version",
          description: "Please try again.",
        });
      }
    })();
  };

  return (
    <VerticalFormControl
      label="Versioned Prompt"
      width="full"
      size="sm"
      paddingBottom={4}
    >
      <HStack justifyContent="space-between">
        <HStack paddingX={1} gap={1}>
          {savedConfig?.handle ? (
            <Text fontSize="sm" fontWeight="500" fontFamily="mono">
              {savedConfig.handle}
            </Text>
          ) : (
            <Text color="gray.500">Draft</Text>
          )}
          {savedConfig?.handle && (
            <CopyButton value={savedConfig.handle} label="Prompt ID" />
          )}
        </HStack>
        {savedConfig && (
          <GeneratePromptApiSnippetDialog
            configId={configId}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton config={savedConfig} />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        )}
        <HStack flex={1} width="50%">
          <PromptSource configId={configId} onSelect={onPromptSourceSelect} />
        </HStack>
        {node.data.configId && (
          <VersionHistoryButton
            configId={node.data.configId}
            onRestore={handleRestore}
          />
        )}
        <VersionSaveButton
          disabled={savedConfig && !hasDrifted}
          onClick={() => void handleSaveVersion()}
        />
      </HStack>
    </VerticalFormControl>
  );
}

/**
 * Utility function to compare objects for equality
 * Used to determine if form values have changed
 */
function isEqual(a: any, b: any) {
  return JSON.stringify(a, null, 2) === JSON.stringify(b, null, 2);
}
