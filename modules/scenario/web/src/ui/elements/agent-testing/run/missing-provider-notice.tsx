/**
 * What a project without a model provider reads instead of a queued run.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, Text, VStack } from "@chakra-ui/react";

export function MissingProviderNotice() {
  return (
    <VStack
      align="start"
      gap={2}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      padding={3}
      data-testid="run-dialog-missing-provider"
    >
      <Text fontSize="sm" fontWeight="medium">
        No model provider is set up
      </Text>
      <Text fontSize="xs" color="fg.muted">
        A run needs a model provider to simulate the user and judge the result.
      </Text>
      <Button
        size="xs"
        variant="outline"
        onClick={() => window.open("/settings/model-providers", "_blank", "noopener,noreferrer")}
      >
        Open model provider settings
      </Button>
    </VStack>
  );
}
