/**
 * The chips that customize a dialog: the run dialog and the scenario dialog both offer their
 * optional fields this way.
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

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
      <Text textStyle="caption" fontWeight="medium" color="fg.muted">
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
            paddingX="2.5"
            borderRadius="lg"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            boxShadow="none"
            textStyle="caption"
            fontWeight="medium"
            color="fg.muted"
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
