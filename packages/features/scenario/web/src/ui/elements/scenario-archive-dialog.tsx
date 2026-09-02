import { Button, List, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import type { ScenarioArchiveItem } from "../../model/scenario-list.types";

export type ScenarioArchiveDialogProps = {
  open: boolean;
  onClose(): void;
  onConfirm(): void;
  scenarios: ScenarioArchiveItem[];
  isLoading?: boolean;
};

export function ScenarioArchiveDialog({
  open,
  onClose,
  onConfirm,
  scenarios,
  isLoading = false,
}: ScenarioArchiveDialogProps) {
  const isBatch = scenarios.length > 1;
  const title = isBatch ? `Archive ${scenarios.length} scenarios?` : "Archive scenario?";

  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Content
        bg="bg"
        maxWidth="500px"
        onClick={(event) => event.stopPropagation()}
      >
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
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            colorPalette="orange"
            onClick={(event) => {
              event.stopPropagation();
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
