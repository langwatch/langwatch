/**
 * Confirmation dialog for archiving a suite: shows the name, explains
 * archiving is reversible and test runs are preserved, using orange
 * (warning) rather than red (danger) since it's reversible.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

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
  /** The question the dialog asks. A test suite asks about a test suite instead. */
  title?: string;
  /** What happens on confirm. A test suite also archives the scenarios it holds. */
  description?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      placement="center"
      busy={isLoading}
      primaryAction={{ label: "Archive", loading: isLoading, onClick: onConfirm }}
    >
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
    </Dialog>
  );
}
