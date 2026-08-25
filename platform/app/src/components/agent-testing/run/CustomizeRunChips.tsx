/**
 * The "Customize your run" chips of the run dialog.
 *
 * Each chip adds one field to the form. A chip that was chosen is no longer
 * offered; removing its field offers it again.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FG_MUTED } from "../shared/design";

export type CustomizeRunChip = {
  key: string;
  label: string;
  onAdd: () => void;
};

export function CustomizeRunChips({ chips }: { chips: CustomizeRunChip[] }) {
  if (chips.length === 0) return null;

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingTop={3}
      data-testid="customize-run-chips"
    >
      <Text fontSize="11.5px" fontWeight="medium" color={FG_MUTED}>
        Customize your run
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
