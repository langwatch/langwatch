import { Button, List, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";

type ScenarioToArchive = {
  id: string;
  name: string;
};

/**
 * Confirmation dialog for archiving one or more scenarios.
 *
 * - Single scenario: shows "Archive scenario?" with the scenario name.
 * - Multiple scenarios: shows "Archive N scenarios?" with a list of names.
 * - Uses orange (warning) color rather than red (danger) since archiving is reversible.
 *
 * Note: All interactive elements use stopPropagation() to prevent event bubbling,
 * since this dialog may be rendered inside clickable parent elements.
 */
export function ScenarioArchiveDialog({
  open,
  onClose,
  onConfirm,
  scenarios,
  isLoading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  scenarios: ScenarioToArchive[];
  isLoading?: boolean;
}) {
  const isBatch = scenarios.length > 1;
  const title = isBatch
    ? `Archive ${scenarios.length} scenarios?`
    : "Archive scenario?";

  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content maxWidth="500px" onClick={(e) => e.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {title}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            {isBatch ? (
              <List.Root paddingLeft={4}>
                {scenarios.map((scenario) => (
                  <List.Item key={scenario.id} fontSize="sm">
                    {scenario.name}
                  </List.Item>
                ))}
              </List.Root>
            ) : (
              scenarios[0] && (
                <Text>
                  <Text as="span" fontWeight="semibold">
                    {scenarios[0].name}
                  </Text>
                </Text>
              )
            )}
            <Text color="fg.muted" fontSize="sm">
              Archived scenarios will no longer appear in the library.
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
