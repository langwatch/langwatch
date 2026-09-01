/**
 * Confirmation dialog for archiving a suite.
 *
 * Shows the suite name and explains that archiving is reversible
 * and test runs are preserved.
 *
 * Uses orange (warning) color rather than red (danger) since archiving is reversible.
 */

import { Button, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";

/** What the dialog says when the caller does not name the thing being archived. */
const defaultTitle = "Archive run plan?";
const defaultDescription =
  "Archived run plans will no longer appear in the sidebar. Test runs are preserved.";

export function SuiteArchiveDialog({
  open,
  onClose,
  onConfirm,
  suiteName,
  isLoading = false,
  title = defaultTitle,
  description = defaultDescription,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suiteName: string;
  isLoading?: boolean;
  /**
   * What the dialog asks, for a surface that calls the thing something else.
   * The Test Runs rail archives a test suite, and a suite takes its test cases
   * with it, so it says so rather than borrowing the run plan wording.
   */
  title?: string;
  /** What archiving does, in the same surface's words as {@link title}. */
  description?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content bg="bg" maxWidth="500px" onClick={(e) => e.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {title}
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
              {description}
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
