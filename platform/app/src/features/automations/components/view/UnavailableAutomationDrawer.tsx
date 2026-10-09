import { Heading, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { HandledErrorAlert } from "~/features/errors/components/HandledErrorAlert";

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
            <HandledErrorAlert
              error={error}
              fallbackTitle="Couldn't load this automation"
              dismissible={false}
            />
          ) : (
            <VStack align="start" gap={1} data-testid="automation-not-found">
              <Text fontWeight="medium">This automation no longer exists</Text>
              <Text textStyle="sm" color="fg.muted">
                It may have been deleted. Reload the list to see what is there
                now.
              </Text>
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
