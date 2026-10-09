/**
 * The chips that customize a dialog: the run dialog and the scenario dialog
 * both offer their optional fields this way.
 *
 * Each chip adds one block to the form. A chip that was chosen is no longer
 * offered; removing its block offers it again.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FG_MUTED } from "./design";

export type CustomizeChip = {
  key: string;
  label: string;
  onAdd: () => void;
};

export function CustomizeChips({
  title,
  chips,
  testId,
}: {
  /** What the section says the chips do. */
  title: string;
  chips: CustomizeChip[];
  testId: string;
}) {
  if (chips.length === 0) return null;

  return (
    <VStack align="stretch" gap={2} paddingTop={3} data-testid={testId}>
      <Text fontSize="11.5px" fontWeight="medium" color={FG_MUTED}>
        {title}
      </Text>
      <HStack gap={2} flexWrap="wrap">
        {chips.map((chip) => (
          <chakra.button
            key={chip.key}
            type="button"
            display="flex"
            alignItems="center"
            gap={1.5}
            height="28px"
            paddingX="10px"
            borderRadius="lg"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            boxShadow="none"
            fontSize="12px"
            fontWeight="medium"
            color={FG_MUTED}
            cursor="pointer"
            _hover={{ background: "bg.muted/60", color: "fg" }}
            onClick={chip.onAdd}
            data-testid={`customize-chip-${chip.key}`}
          >
            <Plus size={12} />
            {chip.label}
          </chakra.button>
        ))}
      </HStack>
    </VStack>
  );
}
