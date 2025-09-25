import { HStack, Spacer, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useFormContext } from "react-hook-form";

import { PromptSource } from "./PromptSource";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { VersionHistoryButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionHistoryButton";
import { VersionSaveButton } from "~/prompt-configs/forms/prompt-config-form/components/VersionSaveButton";
import { usePrompts, type PromptConfigFormValues } from "~/prompt-configs";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToLlmPromptConfigComponentNodeData,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";

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
  node: {
    id: string;
    data: Pick<Node<LlmPromptConfigComponent>["data"], "configId">;
  },
  onPromptSourceSelect: (config: { id: string; name: string }) => void;
}) {
  const trpc = api.useContext();
  const { projectId = "" } = useOrganizationTeamProject();
  const configId = node.data.configId;
  const setNode = useSmartSetNode();
  const formProps = useFormContext<PromptConfigFormValues>();
  const { triggerSaveVersion } = usePromptConfigContext();
  const isDirty = formProps.formState.isDirty;
  const { getPromptByHandle } = usePrompts();
  const { project } = useOrganizationTeamProject();
  
  const handleSaveVersion = () => {
    const values = formProps.getValues();
      /**
       * Save new data to the database
       */
      triggerSaveVersion({
        data: {
          ...formValuesToTriggerSaveVersionParams(values),
          projectId,
        },
        onSuccess: (prompt) => {
          // Update the node data with the new prompt
          setNode({
            ...node,
            data: versionedPromptToLlmPromptConfigComponentNodeData(prompt)
          });
        },
      });
  };


  // TODO: Move this outside of the component
  const handleRestore = (versionId: string) => {
    const handle = formProps.getValues().handle;
    void (async () => {
      if (!handle) {
        // This should never happen
        logger.error({ versionId, projectId, handle }, "Prompt handle not set");
        toaster.error({
          title: "Failed to restore prompt version",
          description: "Missing prompt handle",
        });
        return;
      }

      try {
        // Get the versioned prompt
        const prompt = await getPromptByHandle({
          handle,
          versionId,
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
    })();
  };

  const handle = formProps.watch("handle");
  return (
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
          {handle ? (
            <Text fontSize="sm" fontWeight="500" fontFamily="mono">
              {handle}
            </Text>
          ) : (
            <Text color="gray.500">Draft</Text>
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
            onRestore={handleRestore}
          />
        )}
        <VersionSaveButton
          disabled={!isDirty}
          onClick={() => void handleSaveVersion()}
          hideLabel={true}
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
