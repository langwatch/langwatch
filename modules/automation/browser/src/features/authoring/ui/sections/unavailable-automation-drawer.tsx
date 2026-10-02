import { Drawer } from "@langwatch/design-system/drawer";
import { Alert, Heading, Text, VStack } from "@langwatch/design-system/primitives";

import { useDescribeError } from "../../../../behavior/automation-feedback.ts";

/**
 * The view drawer for a link whose automation cannot be shown: it no longer
 * exists, or loading it failed. There is nothing to edit, so no Edit button.
 */
export function UnavailableAutomationDrawer({
  error,
  onClose,
}: {
  /** Absent when the automation simply does not exist. */
  error: unknown;
  onClose: () => void;
}) {
  const describeError = useDescribeError();
  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading size="md">Automation</Heading>
        </Drawer.Header>
        <Drawer.Body>
          {error ? (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>
                  {describeError({ error, fallbackTitle: "Couldn't load this automation" })}
                </Alert.Title>
              </Alert.Content>
            </Alert.Root>
          ) : (
            <VStack align="start" gap={1} data-testid="automation-not-found">
              <Text fontWeight="medium">This automation no longer exists</Text>
              <Text textStyle="sm" color="fg.muted">
                It may have been deleted. Reload the list to see what is there now.
              </Text>
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
