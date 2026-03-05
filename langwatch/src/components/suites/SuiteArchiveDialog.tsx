/**
 * Confirmation dialog for archiving a suite.
 *
 * Shows the suite name and explains that archiving is reversible
 * and test runs are preserved.
 *
 * Uses orange (warning) color rather than red (danger) since archiving is reversible.
 */

import { Button, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";

export function SuiteArchiveDialog({
  open,
  onClose,
  onConfirm,
  suiteName,
  isLoading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suiteName: string;
  isLoading?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content maxWidth="500px" onClick={(e) => e.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Archive suite?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <Text>
              <Text as="span" fontWeight="semibold">
                {suiteName}
              </Text>
            </Text>
            <Text color="fg.muted" fontSize="sm">
              Archived suites will no longer appear in the sidebar. Test runs are preserved.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            mr={3}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            colorPalette="orange"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            disabled={isLoading}
          >
            {isLoading ? <Spinner size="sm" /> : "Archive"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
