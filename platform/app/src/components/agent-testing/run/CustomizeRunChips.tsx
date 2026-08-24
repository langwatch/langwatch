/**
 * The "Customize your run" chips of the run dialog.
 *
 * Each chip adds one field to the form. A chip that was chosen is no longer
 * offered; removing its field offers it again.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";

export type CustomizeRunChip = {
  key: string;
  label: string;
  onAdd: () => void;
};

export function CustomizeRunChips({ chips }: { chips: CustomizeRunChip[] }) {
  if (chips.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} data-testid="customize-run-chips">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted">
        Customize your run
      </Text>
      <HStack gap={2} flexWrap="wrap">
        {chips.map((chip) => (
          <Button
            key={chip.key}
            size="xs"
            variant="outline"
            borderStyle="dashed"
            color="fg.muted"
            onClick={chip.onAdd}
            data-testid={`customize-chip-${chip.key}`}
          >
            <Plus size={12} />
            {chip.label}
          </Button>
        ))}
      </HStack>
    </VStack>
  );
}
