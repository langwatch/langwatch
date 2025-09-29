import { Button, Alert, HStack, Text } from "@chakra-ui/react";
import { RefreshCw } from "react-feather";
import type { Node } from "@xyflow/react";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { useNodeDrift } from "./hooks/useNodeDrift";

/**
 * Detects drift between optimization studio node data and database version.
 * Shows a visual indicator and provides option to load latest version when drift is detected.
 */
export function PromptDriftWarning({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  const { hasDrift, loadLatestVersion, isLoadingPrompt } = useNodeDrift(node);

  if (hasDrift && !isLoadingPrompt) {
    return (
      <Alert.Root
        size="sm"
        borderStartWidth="3px"
        borderStartColor="blue.500"
        background="blue.50"
        marginBottom={2}
        borderRadius="md"
      >
        <Alert.Indicator />
        <Alert.Content>
          <HStack justifyContent="space-between" width="full">
            <Text fontSize="xs" color="blue.700">
              Your workspace differs from the latest saved version
            </Text>
            <Button
              size="xs"
              variant="solid"
              colorPalette="blue"
              onClick={() => void loadLatestVersion()}
            >
              <RefreshCw size={12} />
              Sync
            </Button>
          </HStack>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return null;
}
