import { Dialog } from "@langwatch/design-system/dialog";
import { List, Text, VStack } from "@langwatch/design-system/primitives";

import type { ScenarioArchiveItem } from "../../model/scenario-list.types.ts";

export type ScenarioArchiveDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
    </Dialog>
  );
}
