/**
 * What a project without a model provider reads instead of a queued run.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Alert, Button } from "@langwatch/design-system/primitives";

export function MissingProviderNotice() {
  return (
    <Alert.Root status="warning" size="sm" data-testid="run-dialog-missing-provider">
      <Alert.Indicator />
      <Alert.Content gap={2}>
        <Alert.Title>No model provider is set up</Alert.Title>
        <Alert.Description>
          A run needs a model provider to simulate the user and judge the result.
        </Alert.Description>
        <Button
          size="xs"
          variant="outline"
          alignSelf="start"
          onClick={() => window.open("/settings/model-providers", "_blank", "noopener,noreferrer")}
        >
          Open model provider settings
        </Button>
      </Alert.Content>
    </Alert.Root>
  );
}
