import { Button, Alert, HStack, Text } from "@chakra-ui/react";
import { RefreshCw } from "react-feather";
import { useMemo, useCallback } from "react";
import type { Node } from "@xyflow/react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { api } from "~/utils/api";
import {
  isNodeDataEqual,
  versionedPromptToOptimizationStudioNodeData,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import { useFormContext } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";

const logger = createLogger(
  "langwatch:optimization_studio:prompt_drift_detector"
);

/**
 * Detects drift between optimization studio node data and database version.
 * Shows a visual indicator and provides option to load latest version when drift is detected.
 */
export function PromptDriftWarning({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  const { project } = useOrganizationTeamProject();
  const configId = node.data.configId;
  const { data: latestPrompt, isLoading: isLoadingPrompt } =
    api.prompts.getById.useQuery({
      id: configId,
      projectId: project?.id ?? "",
    });
  const formProps = useFormContext<PromptConfigFormValues>();
  const isDirty = formProps.formState.isDirty;

  /**
   * If the node data (saved in the studio node array) is different from the latest prompt in the database,
   * show a warning and provide a button to reload the latest version into the form (which should update the node data)
   */
  const hasDrift = useMemo(() => {
    if (!latestPrompt) return false;
    return !isNodeDataEqual(
      node.data,
      versionedPromptToOptimizationStudioNodeData(latestPrompt)
    );
  }, [latestPrompt, node.data]);

  /**
   * Reload the latest version into the form (which should update the node data)
   */
  const handleLoadLatest = useCallback(async () => {
    if (!latestPrompt) throw new Error("Latest prompt not found");

    try {
      formProps.reset(versionedPromptToPromptConfigFormValues(latestPrompt));

      toaster.create({
        title: "Latest version loaded",
        description: "Node has been updated with the latest database version",
        type: "success",
      });
    } catch (error) {
      logger.error({ error, configId }, "Failed to load latest version");
      toaster.create({
        title: "Failed to load latest version",
        description: "Please try again",
        type: "error",
      });
    }
  }, [latestPrompt, formProps, configId]);

  if (!isDirty && hasDrift && !isLoadingPrompt && !configId) {
    return (
      <Alert.Root
        size="md"
        borderStartWidth="4px"
        borderStartColor="orange.500"
        background="orange.50"
        marginBottom={2}
        alignItems="center"
        padding={2}
      >
        <Alert.Indicator />
        <Alert.Content>
          <HStack justifyContent="space-between" width="full">
            <Text fontSize="xs">New version available</Text>
            <Button
              size="xs"
              variant="outline"
              colorPalette="orange"
              onClick={() => void handleLoadLatest()}
            >
              <RefreshCw size={12} />
              Reload
            </Button>
          </HStack>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return null;
}
